package com.mattermost.callsnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * matras: Android-only platform glue of a gomon call — Core-Telecom registration, the ongoing
 * notification's / PiP window's mute and stop-sharing state, and PiP itself. A plain (bridge)
 * module so the shared TurboModule spec, and with it iOS, stays untouched.
 */
class MMCallsPlatformModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val NAME = "MMCallsPlatform"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun getName() = NAME

    /** Registers the call with Telecom (answers the ring for this channel). Resolves false without Telecom. */
    @ReactMethod
    fun startCall(channelId: String, title: String, video: Boolean, promise: Promise) {
        scope.launch {
            val ok = try {
                MMCallsTelecom.start(reactContext, channelId, title, video)
            } catch (_: Exception) {
                false
            }
            promise.resolve(ok)
        }
    }

    @ReactMethod
    fun endCall() {
        MMCallsTelecom.end()
        val activity = reactContext.currentActivity
        // Hung up from the PiP window: close it instead of leaving a dead call on screen.
        if (MMCallsPip.inPip) activity?.runOnUiThread { activity.moveTaskToBack(true) }
        MMCallsPip.configure(activity, false, 0, 0)
    }

    /** Mute / screen-sharing state for the system, the call notification and the PiP actions. */
    @ReactMethod
    fun setCallState(muted: Boolean, sharing: Boolean) {
        val changed = MMCallsForegroundService.muted != muted || MMCallsForegroundService.sharing != sharing
        MMCallsForegroundService.muted = muted
        MMCallsForegroundService.sharing = sharing
        MMCallsTelecom.setMuted(reactContext, muted)
        if (changed) {
            MMCallsForegroundService.refresh()
            MMCallsPip.apply(reactContext.currentActivity)
        }
    }

    /** PiP auto-enter + keep the screen on while the call shows video. */
    @ReactMethod
    fun setPip(enabled: Boolean, width: Double, height: Double) {
        MMCallsPip.configure(reactContext.currentActivity, enabled, width.toInt(), height.toInt())
    }

    @ReactMethod
    fun isInPip(promise: Promise) {
        promise.resolve(MMCallsPip.inPip)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // NativeEventEmitter
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        // NativeEventEmitter
    }
}
