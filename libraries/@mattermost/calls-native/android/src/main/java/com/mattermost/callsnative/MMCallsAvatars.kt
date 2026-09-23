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
}
