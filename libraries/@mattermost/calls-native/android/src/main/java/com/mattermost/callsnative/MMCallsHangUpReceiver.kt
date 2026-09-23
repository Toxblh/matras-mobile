package com.mattermost.callsnative

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Arguments

/**
 * matras: "Hang up" action of the ongoing-call notification. JS is necessarily alive during
 * a call, so this just raises CallEnded and lets the calls code leave the call.
 */
class MMCallsHangUpReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_HANG_UP = "com.mattermost.callsnative.HANG_UP"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_HANG_UP) {
            return
        }
        val body = Arguments.createMap().apply { putString("uuid", "") }
        MMCallsIncomingCall.emit(MMCallsIncomingCall.reactContext(context), MMCallsIncomingCall.EVENT_CALL_ENDED, body)
    }
}
