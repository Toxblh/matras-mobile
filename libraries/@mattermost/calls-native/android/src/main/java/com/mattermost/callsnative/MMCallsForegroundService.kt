package com.mattermost.callsnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat

/**
 * Keeps the microphone (and, during a video call, the camera) alive while
 * the user is in a Mattermost call and the app is in the background.
 * Android requires any process holding the mic/camera in background to run
 * inside a foreground service declaring the matching FOREGROUND_SERVICE_*
 * type since API 34.
 *
 * Title/body/channel strings come from the JS layer via the Intent extras
 * below — keeps i18n in one place.
 */
class MMCallsForegroundService : Service() {
    companion object {
        const val NOTIFICATION_ID = 345678

        const val EXTRA_CHANNEL_ID = "channelId"
        const val EXTRA_CHANNEL_NAME = "channelName"
        const val EXTRA_CHANNEL_DESCRIPTION = "channelDescription"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_SERVER_URL = "serverUrl"
        const val EXTRA_AVATAR_USER_ID = "avatarUserId"
        const val EXTRA_WITH_CAMERA = "withCamera"

        // matras: what the ongoing-call notification and the PiP window offer (MMCallsPlatformModule).
        @Volatile var muted: Boolean? = null
        @Volatile var sharing = false
        @Volatile private var current: MMCallsForegroundService? = null

        /** Re-posts the running call's notification with the current mute / sharing actions. */
        fun refresh() {
            current?.repost()
        }
    }

    private var channelId = "calls_channel"
    private var title = ""
    private var text = ""
    private var avatar: Bitmap? = null

    private fun repost() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(channelId, title, text, avatar))
    }

    override fun onDestroy() {
        if (current === this) current = null
        muted = null
        sharing = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        current = this
        val channelId = intent?.getStringExtra(EXTRA_CHANNEL_ID) ?: "calls_channel"
        val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME) ?: "Mattermost"
        val channelDescription = intent?.getStringExtra(EXTRA_CHANNEL_DESCRIPTION) ?: ""
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Mattermost"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
        this.channelId = channelId
        this.title = title
        this.text = text
        val withCamera = intent?.getBooleanExtra(EXTRA_WITH_CAMERA, false) ?: false

        ensureChannel(channelId, channelName, channelDescription)

        val notification = buildNotification(channelId, title, text, avatar)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Only request the camera type while video is actually on (and the
            // permission has actually been granted) so audio-only calls don't
            // hold a permission they don't use.
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            // matras: a Core-Telecom call gives the service the phoneCall type as well.
            if (MMCallsTelecom.isActive) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            }
            if (withCamera && hasCameraPermission()) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
            startForeground(NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        // matras: the DM partner's avatar arrives after a network fetch; start the service
        // immediately (Android requires it within seconds) and re-post once we have it.
        val serverUrl = intent?.getStringExtra(EXTRA_SERVER_URL)
        val avatarUserId = intent?.getStringExtra(EXTRA_AVATAR_USER_ID)
        if (!serverUrl.isNullOrEmpty() && !avatarUserId.isNullOrEmpty()) {
            Thread {
                avatar = MMCallsAvatars.load(applicationContext, serverUrl, avatarUserId) ?: return@Thread
                repost()
            }.start()
        }
        return START_NOT_STICKY
    }

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun ensureChannel(channelId: String, channelName: String, description: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val existing = manager.getNotificationChannel(channelId)
        if (existing == null) {
            val channel = NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_LOW).apply {
                this.description = description
                enableVibration(false)
                setSound(null, null)
            }
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(channelId: String, title: String, text: String, avatar: Bitmap?): Notification {
        // matras: render as a system ongoing call (timer + Hang up) instead of a plain note.
        val hangUp = MMCallsHangUpReceiver.intent(this, MMCallsHangUpReceiver.ACTION_HANG_UP)
        val callee = Person.Builder().setName(title.ifEmpty { "Mattermost" }).setIcon(MMCallsAvatars.icon(avatar)).build()
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val builder = NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(MMCallsAvatars.smallIcon(this))
            .setOngoing(true)
            .setUsesChronometer(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(callee, hangUp))
        if (launch != null) {
            builder.setContentIntent(launch)
        }
        if (avatar != null) {
            builder.setLargeIcon(avatar)
        }
        muted?.let {
            builder.addAction(
                if (it) R.drawable.calls_ic_mic_off else R.drawable.calls_ic_mic,
                getString(if (it) R.string.calls_unmute else R.string.calls_mute),
                MMCallsHangUpReceiver.intent(this, MMCallsHangUpReceiver.ACTION_TOGGLE_MUTE),
            )
        }
        if (sharing) {
            builder.addAction(
                R.drawable.calls_ic_stop_share,
                getString(R.string.calls_stop_share),
                MMCallsHangUpReceiver.intent(this, MMCallsHangUpReceiver.ACTION_STOP_SHARE),
            )
        }
        // Android 16 Live Updates: the call as a status-bar chip (Notification.EXTRA_REQUEST_PROMOTED_ONGOING).
        builder.extras.putBoolean("android.requestPromotedOngoing", true)
        return builder.build()
    }

}
