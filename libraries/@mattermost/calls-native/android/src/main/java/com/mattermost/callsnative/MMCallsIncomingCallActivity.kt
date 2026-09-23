package com.mattermost.callsnative

import android.app.Activity
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * matras: full-screen "incoming call" shown by the CallStyle notification's full-screen
 * intent when the device is locked or idle. It only relays the decision: Answer fires the
 * same PendingIntent as the notification's Answer action (launches the app, JS joins the
 * call), Decline fires the host app's decline receiver. It closes on either, on the
 * ring timeout, or when MMCallsIncomingCall.cancel() broadcasts ACTION_CANCELLED.
 */
class MMCallsIncomingCallActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val cancelReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val channelName = intent.getStringExtra(MMCallsIncomingCall.EXTRA_CHANNEL_NAME).orEmpty()
        val callerName = intent.getStringExtra(MMCallsIncomingCall.EXTRA_CALLER_NAME).orEmpty()
            .ifEmpty { channelName }
            .ifEmpty { getString(R.string.calls_incoming_call) }
        val answer = pendingIntentExtra(MMCallsIncomingCall.EXTRA_ANSWER_INTENT)
        val decline = pendingIntentExtra(MMCallsIncomingCall.EXTRA_DECLINE_INTENT)

        setContentView(buildView(callerName, channelName, answer, decline))

        val filter = IntentFilter(MMCallsIncomingCall.ACTION_CANCELLED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(cancelReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(cancelReceiver, filter)
        }
        handler.postDelayed({ finish() }, MMCallsIncomingCall.RING_TIMEOUT_MS)
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        try {
            unregisterReceiver(cancelReceiver)
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // The ring stays until Answer, Decline or timeout — like the phone dialer.
    }

    private fun pendingIntentExtra(name: String): PendingIntent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(name, PendingIntent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(name)
        }

    private fun answer(pi: PendingIntent?) {
        // The app itself is not showWhenLocked; ask for the unlock first so the call screen
        // is what comes up, not the keyguard on top of it.
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() = fire(pi)
                override fun onDismissCancelled() = finish()
                override fun onDismissError() = fire(pi)
            })
            return
        }
        fire(pi)
    }

    private fun fire(pi: PendingIntent?) {
        try {
            pi?.send()
        } catch (_: PendingIntent.CanceledException) {
        }
        finish()
    }

    private fun buildView(callerName: String, channelName: String, answer: PendingIntent?, decline: PendingIntent?): View {
        val dp = resources.displayMetrics.density
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(0x14, 0x19, 0x24))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((32 * dp).toInt(), (96 * dp).toInt(), (32 * dp).toInt(), (64 * dp).toInt())
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.calls_incoming_call)
            setTextColor(Color.argb(0xB3, 0xFF, 0xFF, 0xFF))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        })
        root.addView(TextView(this).apply {
            text = callerName
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(0, (16 * dp).toInt(), 0, (8 * dp).toInt())
        })
        if (channelName.isNotEmpty() && channelName != callerName) {
            root.addView(TextView(this).apply {
                text = channelName
                setTextColor(Color.argb(0xB3, 0xFF, 0xFF, 0xFF))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
                gravity = Gravity.CENTER
            })
        }
        root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val buttonParams = LinearLayout.LayoutParams(0, (64 * dp).toInt(), 1f).apply {
            marginStart = (12 * dp).toInt()
            marginEnd = (12 * dp).toInt()
        }
        buttons.addView(Button(this).apply {
            text = getString(R.string.calls_decline)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(0xD2, 0x46, 0x46))
            setOnClickListener { fire(decline) }
        }, buttonParams)
        buttons.addView(Button(this).apply {
            text = getString(R.string.calls_answer)
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(0x3D, 0xB8, 0x87))
            setOnClickListener { answer(answer) }
        }, buttonParams)
        root.addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        return root
    }
}
