package com.mattermost.callsnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/**
 * matras: system incoming-call UI for Android, the counterpart of CallKitProvider on iOS.
 *
 * A CallStyle notification (heads-up with Answer / Decline, looping ringtone) plus a
 * full-screen activity for the locked or idle screen. The host app posts it straight from
 * the FCM push handler, so it works while the React process is dead; once JS is alive it
 * takes the ring down through reportEnded / reportConnected, and the notification times
 * itself out after RING_TIMEOUT_MS when nobody does.
 */
object MMCallsIncomingCall {
    const val NOTIFICATION_ID = 345679
    private const val CHANNEL_ID = "calls_incoming_v1"
    const val RING_TIMEOUT_MS = 30_000L

    const val EXTRA_UUID = "uuid"
    const val EXTRA_SERVER_ID = "serverId"
    const val EXTRA_SERVER_URL = "serverUrl"
    const val EXTRA_CHANNEL_ID = "channelId"
    const val EXTRA_POST_ID = "postId"
    const val EXTRA_THREAD_ID = "threadId"
    const val EXTRA_CALLER_ID = "callerId"
    const val EXTRA_CALLER_NAME = "callerName"
    const val EXTRA_CHANNEL_NAME = "channelName"
    const val EXTRA_ANSWER_INTENT = "answerIntent"
    const val EXTRA_DECLINE_INTENT = "declineIntent"

    // In-app broadcast telling the full-screen activity that the ring is over.
    const val ACTION_CANCELLED = "com.mattermost.callsnative.INCOMING_CALL_CANCELLED"

    // Event names shared with the JS side (see NativeMMCallsNative.ts CallsNativeEvents).
    const val EVENT_INCOMING_CALL = "IncomingCall"
    const val EVENT_CALL_DECLINED = "CallDeclined"
    const val EVENT_CALL_ENDED = "CallEnded"

    @Volatile private var currentUuid: String? = null

    /** Same call → same UUID in every process, so JS and native agree without a handshake. */
    fun uuidFor(serverId: String, channelId: String): String =
        UUID.nameUUIDFromBytes("$serverId:$channelId".toByteArray()).toString()

    fun show(
        context: Context,
        call: Bundle,
        contentIntent: PendingIntent,
        answerIntent: PendingIntent,
        declineIntent: PendingIntent,
    ) {
        val uuid = call.getString(EXTRA_UUID) ?: return
        cancel(context)
        ensureChannel(context)

        val channelName = call.getString(EXTRA_CHANNEL_NAME).orEmpty()
        val callerName = call.getString(EXTRA_CALLER_NAME).orEmpty()
            .ifEmpty { channelName }
            .ifEmpty { context.getString(R.string.calls_incoming_call) }

        val fullScreen = Intent(context, MMCallsIncomingCallActivity::class.java).apply {
            putExtras(call)
            putExtra(EXTRA_ANSWER_INTENT, answerIntent)
            putExtra(EXTRA_DECLINE_INTENT, declineIntent)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val fullScreenIntent = PendingIntent.getActivity(
            context, uuid.hashCode(), fullScreen,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val caller = Person.Builder().setName(callerName).setImportant(true).build()
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(appIcon(context))
            .setContentTitle(callerName)
            .setContentText(channelName.ifEmpty { context.getString(R.string.calls_incoming_call) })
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declineIntent, answerIntent))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(fullScreenIntent, true)
            .setTimeoutAfter(RING_TIMEOUT_MS)
            .build()
        // Loop the channel ringtone until the notification goes away.
        notification.flags = notification.flags or Notification.FLAG_INSISTENT

        currentUuid = uuid
        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    }

    /**
     * Takes the ring UI down. With a uuid, only when it is the call currently ringing in this
     * process; without one, unconditionally (a fresh process cannot know what is showing).
     */
    fun cancel(context: Context, uuid: String? = null): Boolean {
        val current = currentUuid
        if (uuid != null && current != null && uuid != current) {
            return false
        }
        currentUuid = null
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        context.sendBroadcast(Intent(ACTION_CANCELLED).setPackage(context.packageName))
        return true
    }

    /** Payload for the JS IncomingCall event, mirroring what CallKitProvider sends on iOS. */
    fun incomingCallPayload(call: Bundle): WritableMap = Arguments.createMap().apply {
        putString("uuid", call.getString(EXTRA_UUID))
        putString("channelId", call.getString(EXTRA_CHANNEL_ID).orEmpty())
        putString("serverId", call.getString(EXTRA_SERVER_ID).orEmpty())
        putString("postId", call.getString(EXTRA_POST_ID).orEmpty())
        putString("threadId", call.getString(EXTRA_THREAD_ID).orEmpty())
        putString("callerId", call.getString(EXTRA_CALLER_ID).orEmpty())
        putString("callerName", call.getString(EXTRA_CALLER_NAME).orEmpty())
    }

    /** The live React context, or null while the JS side is not running. */
    fun reactContext(context: Context): ReactContext? =
        (context.applicationContext as? ReactApplication)?.reactHost?.currentReactContext

    fun emit(reactContext: ReactContext?, event: String, body: WritableMap) {
        try {
            reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(event, body)
        } catch (_: Exception) {
            // JS bridge not ready — the notification still stands on its own.
        }
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return
        }
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        // ponytail: the ringtone is fixed at channel creation; the per-user tone preference
        // lives in JS. Users change it in the system channel settings, which is the Android way.
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.calls_channel_incoming), NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(ringtoneUri(context), attrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 1000, 500, 1000, 500, 1000)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    private fun ringtoneUri(context: Context): Uri {
        val id = context.resources.getIdentifier("calls_calm", "raw", context.packageName)
        return if (id != 0) {
            Uri.parse("android.resource://${context.packageName}/$id")
        } else {
            RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        }
    }

    private fun appIcon(context: Context): Int =
        context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).icon
}
