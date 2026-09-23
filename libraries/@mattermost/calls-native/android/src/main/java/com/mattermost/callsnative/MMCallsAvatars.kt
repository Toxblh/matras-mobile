package com.mattermost.callsnative

import android.content.Context
import android.graphics.Bitmap
import androidx.core.graphics.drawable.IconCompat

/**
 * matras: avatars for the call notifications. The library has no server access of its own,
 * so the host app plugs in its authenticated, cached profile-image loader at startup
 * (MainApplication). Without a loader, or when the fetch fails, calls just show no picture.
 */
object MMCallsAvatars {
    @Volatile var loader: ((context: Context, serverUrl: String, userId: String) -> Bitmap?)? = null

    /** Blocking — call off the main thread. */
    fun load(context: Context, serverUrl: String?, userId: String?): Bitmap? {
        if (serverUrl.isNullOrEmpty() || userId.isNullOrEmpty()) {
            return null
        }
        return try {
            loader?.invoke(context, serverUrl, userId)
        } catch (_: Exception) {
            null
        }
    }

    fun icon(bitmap: Bitmap?): IconCompat? = bitmap?.let { IconCompat.createWithBitmap(it) }

    /**
     * Status-bar icon for call notifications. The launcher icon is full-colour, so the status
     * bar and the call chip render it as a white blob; the app's monochrome push icon
     * (mipmap/ic_notification) is what the system expects there.
     */
    fun smallIcon(context: Context): Int {
        val res = context.resources
        val id = res.getIdentifier("ic_notification", "mipmap", context.packageName)
            .takeIf { it != 0 } ?: res.getIdentifier("ic_notification", "drawable", context.packageName)
        return if (id != 0) id else context.applicationInfo.icon
    }
}
