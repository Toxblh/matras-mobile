package com.mattermost.callsnative

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Arguments

/**
 * matras: actions of the ongoing-call notification and the PiP window. JS is necessarily alive
 * during a call: "Hang up" raises CallEnded and lets the calls code leave the call; mute and
 * stop-sharing go to the gomon call as GomonCallAction.
 */
class MMCallsHangUpReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_HANG_UP = "com.mattermost.callsnative.HANG_UP"
        const val ACTION_TOGGLE_MUTE = "com.mattermost.callsnative.TOGGLE_MUTE"
        const val ACTION_STOP_SHARE = "com.mattermost.callsnative.STOP_SHARE"
        const val EVENT_CALL_ACTION = "GomonCallAction"

        fun intent(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
            context, action.hashCode(),
            Intent(context, MMCallsHangUpReceiver::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    override fun onReceive(context: Context, intent: Intent) {
        val react = MMCallsIncomingCall.reactContext(context)
        when (intent.action) {
            ACTION_HANG_UP -> {
                val body = Arguments.createMap().apply { putString("uuid", "") }
                MMCallsIncomingCall.emit(react, MMCallsIncomingCall.EVENT_CALL_ENDED, body)
            }
            ACTION_TOGGLE_MUTE, ACTION_STOP_SHARE -> {
                val body = Arguments.createMap().apply {
                    putString("action", if (intent.action == ACTION_TOGGLE_MUTE) "toggleMute" else "stopShare")
                }
                MMCallsIncomingCall.emit(react, EVENT_CALL_ACTION, body)
            }
        }
    }
}
