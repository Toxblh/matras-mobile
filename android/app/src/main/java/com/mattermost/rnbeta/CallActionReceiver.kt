package com.mattermost.rnbeta

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.facebook.react.bridge.Arguments
import com.mattermost.callsnative.MMCallsIncomingCall
import com.mattermost.helpers.Network
import com.mattermost.turbolog.TurboLog
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

/**
 * matras: "Decline" from the incoming-call notification / full-screen ring.
 * With JS alive it raises CallDeclined and the calls code dismisses the ring server-side
 * (and clears its own state). With the process fresh it posts the dismiss itself, the same
 * REST call the JS client makes, so the other devices stop ringing.
 */
class CallActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_DECLINE = "com.mattermost.rnbeta.CALL_DECLINE"

        fun declineIntent(context: Context, call: Bundle): PendingIntent {
            val intent = Intent(context, CallActionReceiver::class.java)
                .setAction(ACTION_DECLINE)
                .putExtras(call)
            return PendingIntent.getBroadcast(
                context, call.getString(MMCallsIncomingCall.EXTRA_UUID).hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }

    @OptIn(DelicateCoroutinesApi::class)
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_DECLINE) {
            return
        }
        val uuid = intent.getStringExtra(MMCallsIncomingCall.EXTRA_UUID)
        MMCallsIncomingCall.cancel(context, uuid)

        val reactContext = MMCallsIncomingCall.reactContext(context)
        if (reactContext != null) {
            val body = Arguments.createMap().apply { putString("uuid", uuid) }
            MMCallsIncomingCall.emit(reactContext, MMCallsIncomingCall.EVENT_CALL_DECLINED, body)
            return
        }

        val serverUrl = intent.getStringExtra(MMCallsIncomingCall.EXTRA_SERVER_URL)
        val channelId = intent.getStringExtra(MMCallsIncomingCall.EXTRA_CHANNEL_ID)
        if (serverUrl.isNullOrEmpty() || channelId.isNullOrEmpty()) {
            return
        }
        val result = goAsync()
        GlobalScope.launch(Dispatchers.IO) {
            try {
                Network.init(context)
                Network.postSync(serverUrl, "plugins/com.mattermost.calls/calls/$channelId/dismiss-notification", Arguments.createMap())?.close()
            } catch (e: Exception) {
                TurboLog.e("CallActionReceiver", "dismiss-notification failed: ${e.message}")
            } finally {
                result.finish()
            }
        }
    }
}
