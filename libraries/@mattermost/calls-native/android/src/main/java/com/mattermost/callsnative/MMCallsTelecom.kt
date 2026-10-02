package com.mattermost.callsnative

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.DisconnectCause
import android.util.Log
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallEndpointCompat
import androidx.core.telecom.CallsManager
import androidx.core.telecom.extensions.LocalCallSilenceExtension
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * matras: gomon calls registered with the system through Jetpack Core-Telecom.
 *
 * With a call registered, Telecom owns the audio mode, focus and routing (endpoints), car and
 * Bluetooth answer/hang-up buttons reach us, DND treats the ring as a call and the app gets the
 * phoneCall foreground-service type. One call at a time: an incoming ring registered from the
 * push (show) is answered when JS starts the call for the same channel; otherwise JS's start
 * adds an outgoing call. API < 28 or a device without Telecom keeps the manual routing of
 * MMCallsNativeModuleImpl.
 */
object MMCallsTelecom {
    private const val TAG = "MMCallsTelecom"
    const val EVENT_MUTE = "GomonTelecomMute"
    const val EVENT_ANSWER = "GomonTelecomAnswer"
    const val EVENT_DISCONNECT = "GomonTelecomDisconnect"
    const val EVENT_HOLD = "GomonTelecomHold"

    private class Active(val channelId: String, val incoming: Boolean) {
        var scope: CallControlScope? = null
        var silence: LocalCallSilenceExtension? = null
        var job: Job? = null
        var answered = !incoming
        var endedByUs = false
        var endpoints: List<CallEndpointCompat> = emptyList()
        var endpoint: CallEndpointCompat? = null
        var declineIntent: PendingIntent? = null
        var answerIntent: PendingIntent? = null
        var serverUrl: String? = null
        val ready = CompletableDeferred<Boolean>()
    }

    private val io = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var manager: CallsManager? = null
    @Volatile private var active: Active? = null

    /** MMCallsNativeModuleImpl listens here to re-emit the route and update the proximity lock. */
    @Volatile var onRouteChanged: (() -> Unit)? = null

    /** A call is registered with Telecom and owns the audio routing. */
    val isActive: Boolean get() = active?.let { it.answered && it.scope != null } == true

    fun isSupported(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature("android.software.telecom") &&
            context.checkSelfPermission(android.Manifest.permission.MANAGE_OWN_CALLS) == PackageManager.PERMISSION_GRANTED

    private fun manager(context: Context): CallsManager? {
        manager?.let { return it }
        if (!isSupported(context)) return null
        return try {
            CallsManager(context.applicationContext).also {
                it.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
                manager = it
            }
        } catch (e: Exception) {
            Log.w(TAG, "Telecom registration failed", e)
            null
        }
    }

    /** The push rings: let the system know (car/headset Answer, DND as a call). */
    fun addIncoming(context: Context, call: Bundle, answerIntent: PendingIntent, declineIntent: PendingIntent) {
        val channelId = call.getString(MMCallsIncomingCall.EXTRA_CHANNEL_ID) ?: return
        // A call in progress stays; a repeated push for the ringing channel is the same ring.
        active?.let { if (it.answered || it.channelId == channelId) return }
        val title = call.getString(MMCallsIncomingCall.EXTRA_CALLER_NAME).orEmpty()
            .ifEmpty { call.getString(MMCallsIncomingCall.EXTRA_CHANNEL_NAME).orEmpty() }
        val a = Active(channelId, incoming = true).apply {
            this.answerIntent = answerIntent
            this.declineIntent = declineIntent
            serverUrl = call.getString(MMCallsIncomingCall.EXTRA_SERVER_URL)
        }
        if (!add(context, a, title, video = true)) return
        // Nobody answered: the ring times out like the notification does.
        io.launch {
            delay(MMCallsIncomingCall.RING_TIMEOUT_MS)
            if (active === a && !a.answered) {
                end(DisconnectCause.MISSED)
            }
        }
    }

    /**
     * JS starts the call: answers the ring for this channel, or adds an outgoing call. Resolves
     * whether Telecom carries the call (false → manual audio routing).
     */
    suspend fun start(context: Context, channelId: String, title: String, video: Boolean): Boolean {
        active?.let { a ->
            if (a.channelId == channelId) {
                if (withTimeoutOrNull(5_000) { a.ready.await() } != true) return false
                if (!a.answered) {
                    a.answered = true
                    a.scope?.answer(if (video) CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL)
                }
                return a.scope != null
            }
            end(DisconnectCause.LOCAL)
        }
        val a = Active(channelId, incoming = false)
        if (!add(context, a, title, video)) return false
        if (withTimeoutOrNull(5_000) { a.ready.await() } == true) return true
        end()
        return false
    }

    fun end(cause: Int = DisconnectCause.LOCAL) {
        val a = active ?: return
        active = null
        a.endedByUs = true
        val scope = a.scope
        if (scope == null) {
            a.job?.cancel()
            return
        }
        io.launch {
            try {
                scope.disconnect(DisconnectCause(cause))
            } catch (e: Exception) {
                Log.w(TAG, "disconnect", e)
            }
            a.job?.cancel()
        }
    }

    /** Decline from the notification / full-screen ring. */
    fun reject(channelId: String?) {
        val a = active ?: return
        if (!a.answered && (channelId == null || a.channelId == channelId)) {
            end(DisconnectCause.REJECTED)
        }
    }

    /** App mute → the system (local call silence; and lift a system mic mute on unmute). */
    fun setMuted(context: Context, muted: Boolean) {
        val a = active ?: return
        io.launch { a.silence?.updateIsLocallySilenced(muted) }
        if (!muted) {
            val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (audio.isMicrophoneMute) audio.isMicrophoneMute = false
        }
    }

    fun requestRoute(route: String) {
        val a = active ?: return
        val type = when (route) {
            "SPEAKER_PHONE" -> CallEndpointCompat.TYPE_SPEAKER
            "BLUETOOTH" -> CallEndpointCompat.TYPE_BLUETOOTH
            "WIRED_HEADSET" -> CallEndpointCompat.TYPE_WIRED_HEADSET
            else -> CallEndpointCompat.TYPE_EARPIECE
        }
        // ponytail: the first endpoint of the type; a picker per Bluetooth device when people have two.
        val target = a.endpoints.firstOrNull { it.type == type } ?: return
        val scope = a.scope ?: return
        io.launch { scope.requestEndpointChange(target) }
    }

    /** The route in MMCallsNativeModuleImpl's format, so the JS audio picker works unchanged. */
    fun routeMap(): WritableMap? {
        val a = active?.takeIf { it.scope != null } ?: return null
        val list = Arguments.createArray()
        a.endpoints.mapNotNull { routeName(it.type) }.distinct().forEach { list.pushString(it) }
        return Arguments.createMap().apply {
            putString("selectedAudioDevice", a.endpoint?.let { routeName(it.type) } ?: "NONE")
            putArray("availableAudioDeviceList", list)
        }
    }

    private fun routeName(type: Int): String? = when (type) {
        CallEndpointCompat.TYPE_EARPIECE -> "EARPIECE"
        CallEndpointCompat.TYPE_SPEAKER -> "SPEAKER_PHONE"
        CallEndpointCompat.TYPE_BLUETOOTH -> "BLUETOOTH"
        CallEndpointCompat.TYPE_WIRED_HEADSET -> "WIRED_HEADSET"
        else -> null
    }

    private fun emit(context: Context, event: String, body: WritableMap = Arguments.createMap()) =
        MMCallsIncomingCall.emit(MMCallsIncomingCall.reactContext(context), event, body)

    private fun add(context: Context, a: Active, title: String, video: Boolean): Boolean {
        val m = manager(context) ?: return false
        if (active != null) end()
        val attrs = CallAttributesCompat(
            title.ifEmpty { context.getString(R.string.calls_incoming_call) },
            Uri.parse("gomon:${a.channelId}"),
            if (a.incoming) CallAttributesCompat.DIRECTION_INCOMING else CallAttributesCompat.DIRECTION_OUTGOING,
            if (video) CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
            CallAttributesCompat.SUPPORTS_SET_INACTIVE,
        )
        active = a
        val app = context.applicationContext
        a.job = io.launch {
            try {
                m.addCallWithExtensions(
                    attrs,
                    onAnswer = { _ -> onSystemAnswer(app, a) },
                    onDisconnect = { _ -> onSystemDisconnect(app, a) },
                    onSetActive = { emit(app, EVENT_HOLD, Arguments.createMap().apply { putBoolean("held", false) }) },
                    onSetInactive = { emit(app, EVENT_HOLD, Arguments.createMap().apply { putBoolean("held", true) }) },
                ) {
                    a.silence = addLocalCallSilenceExtension(false, true) { silenced ->
                        emit(app, EVENT_MUTE, Arguments.createMap().apply { putBoolean("muted", silenced) })
                    }
                    onCall {
                        a.scope = this
                        if (!a.incoming) setActive()
                        a.ready.complete(true)
                        launch {
                            availableEndpoints.collect {
                                a.endpoints = it
                                onRouteChanged?.invoke()
                            }
                        }
                        launch {
                            currentCallEndpoint.collect {
                                a.endpoint = it
                                onRouteChanged?.invoke()
                            }
                        }
                        launch {
                            // Bluetooth / car / system mute.
                            isMuted.drop(1).collect { muted ->
                                emit(app, EVENT_MUTE, Arguments.createMap().apply { putBoolean("muted", muted) })
                            }
                        }
                    }
                }
            } catch (e: CancellationException) {
                // ended by us
            } catch (e: Exception) {
                Log.w(TAG, "addCall failed", e)
            } finally {
                a.ready.complete(false)
                if (active === a) active = null
                onRouteChanged?.invoke()
            }
        }
        return true
    }

    /** Answer from the system (car, Bluetooth headset, watch). */
    private fun onSystemAnswer(context: Context, a: Active) {
        if (a.answered) return
        a.answered = true
        MMCallsIncomingCall.cancel(context)
        val react = MMCallsIncomingCall.reactContext(context)
        if (react != null && react.hasActiveReactInstance()) {
            emit(context, EVENT_ANSWER, Arguments.createMap().apply {
                putString("channelId", a.channelId)
                putString("serverUrl", a.serverUrl.orEmpty())
            })
            return
        }
        // No JS: open the app as the notification's Answer does (allowed while the ring is shown).
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val opts = ActivityOptions.makeBasic()
                    .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
                a.answerIntent?.send(context, 0, null, null, null, null, opts.toBundle())
            } else {
                a.answerIntent?.send()
            }
        } catch (e: Exception) {
            Log.w(TAG, "answer intent", e)
        }
    }

    /** Hang-up / reject from the system, or Telecom ended the call. */
    private fun onSystemDisconnect(context: Context, a: Active) {
        if (active === a) active = null
        if (a.endedByUs) return
        if (!a.answered) {
            MMCallsIncomingCall.cancel(context)
            try {
                a.declineIntent?.send()
            } catch (_: PendingIntent.CanceledException) {
            }
            return
        }
        emit(context, EVENT_DISCONNECT)
    }
}
