package com.mattermost.callsnative

import android.app.Activity
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import android.view.WindowManager
import com.facebook.react.bridge.Arguments

/**
 * matras: Picture-in-Picture for a video call. While JS says the call shows video, the activity
 * keeps the screen on and enters PiP by itself on Home (API 31+ auto-enter, onUserLeaveHint
 * before that), with mic and hang-up actions. The host activity forwards its PiP callbacks here.
 */
object MMCallsPip {
    const val EVENT_PIP = "GomonPip"

    // PiP accepts aspect ratios between 1:2.39 and 2.39:1.
    private const val MAX_ASPECT = 2.39f

    @Volatile var enabled = false
        private set
    private var aspect = Rational(9, 16)

    @Volatile var inPip = false
        private set

    fun configure(activity: Activity?, enabled: Boolean, width: Int, height: Int) {
        this.enabled = enabled
        if (width > 0 && height > 0) {
            val r = width.toFloat() / height
            aspect = when {
                r > MAX_ASPECT -> Rational(239, 100)
                r < 1 / MAX_ASPECT -> Rational(100, 239)
                else -> Rational(width, height)
            }
        }
        apply(activity)
    }

    /** Mute changed: the PiP action icon follows. */
    fun apply(activity: Activity?) {
        activity ?: return
        activity.runOnUiThread {
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            if (supported(activity)) {
                try {
                    activity.setPictureInPictureParams(params(activity))
                } catch (_: IllegalStateException) {
                    // activity without android:supportsPictureInPicture
                }
            }
        }
    }

    /** Before API 31 there is no auto-enter: the activity calls this from onUserLeaveHint. */
    fun onUserLeaveHint(activity: Activity) {
        if (enabled && Build.VERSION.SDK_INT < Build.VERSION_CODES.S && supported(activity)) {
            try {
                activity.enterPictureInPictureMode(params(activity))
            } catch (_: IllegalStateException) {
            }
        }
    }

    /** dismissed: the PiP window was closed (the activity stays stopped), not expanded back. */
    fun onModeChanged(context: Context, inPip: Boolean, dismissed: Boolean) {
        this.inPip = inPip
        val body = Arguments.createMap().apply {
            putBoolean("active", inPip)
            putBoolean("dismissed", dismissed)
        }
        MMCallsIncomingCall.emit(MMCallsIncomingCall.reactContext(context), EVENT_PIP, body)
    }

    private fun supported(activity: Activity) =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private fun params(activity: Activity): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(aspect)
            .setActions(actions(activity))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(enabled).setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun actions(activity: Activity): List<RemoteAction> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return emptyList()
        val muted = MMCallsForegroundService.muted == true
        val mic = activity.getString(if (muted) R.string.calls_unmute else R.string.calls_mute)
        val hangUp = activity.getString(R.string.calls_hang_up)
        val list = listOf(
            RemoteAction(
                Icon.createWithResource(activity, if (muted) R.drawable.calls_ic_mic_off else R.drawable.calls_ic_mic),
                mic, mic, MMCallsHangUpReceiver.intent(activity, MMCallsHangUpReceiver.ACTION_TOGGLE_MUTE),
            ),
            RemoteAction(
                Icon.createWithResource(activity, R.drawable.calls_ic_call_end),
                hangUp, hangUp, MMCallsHangUpReceiver.intent(activity, MMCallsHangUpReceiver.ACTION_HANG_UP),
            ),
        )
        return list.take(activity.maxNumPictureInPictureActions)
    }
}
