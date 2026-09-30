package com.mattermost.rnbeta

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread

// matras: self-update for sideloaded APKs (releases on altlinux.space).
// JS decides whether and what to install; this module reports the installer,
// downloads + verifies SHA-256, and hands the APK to PackageInstaller.
class SelfUpdateModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    companion object {
        const val NAME = "MatrasSelfUpdate"
        const val PROGRESS_EVENT = "MatrasSelfUpdateProgress"
        private const val ACTION_STATUS = "com.mattermost.rnbeta.SELF_UPDATE_STATUS"
        private const val APK_NAME = "matras-update.apk"
    }

    @Volatile
    private var pendingInstall: Promise? = null
    private var receiverRegistered = false

    override fun getName(): String = NAME

    @ReactMethod
    fun getInfo(promise: Promise) {
        try {
            val pm = context.packageManager
            val pkg = context.packageName
            val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                pm.getInstallSourceInfo(pkg).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                pm.getInstallerPackageName(pkg)
            }
            val canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || pm.canRequestPackageInstalls()
            promise.resolve(Arguments.createMap().apply {
                putString("installer", installer)
                putString("packageName", pkg)
                putString("buildSha", BuildConfig.MATRAS_GIT_SHA)
                putBoolean("canInstall", canInstall)
            })
        } catch (e: Exception) {
            promise.reject("info", e)
        }
    }

    // «Установка неизвестных приложений» for this app.
    @ReactMethod
    fun openInstallSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    // Downloads the APK into the cache and checks its SHA-256 before keeping it.
    // Rejects with "checksum" on mismatch, "download" on network errors.
    @ReactMethod
    fun download(url: String, sha256: String, promise: Promise) {
        thread(name = "matras-self-update-download") {
            val part = File(context.cacheDir, "$APK_NAME.part")
            try {
                val actual = fetchTo(url, part)
                if (!actual.equals(sha256.trim(), ignoreCase = true)) {
                    part.delete()
                    promise.reject("checksum", "SHA-256 mismatch: expected $sha256, got $actual")
                    return@thread
                }
                val apk = File(context.cacheDir, APK_NAME)
                apk.delete()
                if (!part.renameTo(apk)) {
                    throw IOException("Cannot move ${part.name}")
                }
                promise.resolve(null)
            } catch (e: Exception) {
                part.delete()
                promise.reject("download", e.message, e)
            }
        }
    }

    // Installs the APK verified by download(). Resolves when installed (the process is
    // usually killed first); rejects with "signature" when it is signed with another key,
    // "aborted" when the user cancels the system dialog, "failed" otherwise.
    @ReactMethod
    fun install(promise: Promise) {
        if (pendingInstall != null) {
            promise.reject("busy", "Update is already in progress")
            return
        }
        val apk = File(context.cacheDir, APK_NAME)
        if (!apk.exists()) {
            promise.reject("failed", "No downloaded update")
            return
        }
        pendingInstall = promise
        thread(name = "matras-self-update-install") {
            try {
                installFile(apk)
            } catch (e: Exception) {
                finish { it.reject("failed", e.message, e) }
            }
        }
    }

    @Synchronized
    private fun finish(block: (Promise) -> Unit) {
        val p = pendingInstall ?: return
        pendingInstall = null
        block(p)
    }

    private fun fetchTo(url: String, file: File): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 20_000
        conn.readTimeout = 60_000
        conn.instanceFollowRedirects = true
        try {
            if (conn.responseCode !in 200..299) {
                throw IOException("HTTP ${conn.responseCode}")
            }
            val total = conn.contentLengthLong
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            var lastPercent = -1
            conn.inputStream.use { input ->
                FileOutputStream(file).use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        received += n
                        val percent = if (total > 0) (received * 100 / total).toInt() else -1
                        if (percent != lastPercent) {
                            lastPercent = percent
                            emitProgress(received, total)
                        }
                    }
                }
            }
            if (total > 0 && received != total) {
                throw IOException("Truncated download: $received of $total bytes")
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        } finally {
            conn.disconnect()
        }
    }

    private fun emitProgress(received: Long, total: Long) {
        context.emitDeviceEvent(PROGRESS_EVENT, Arguments.createMap().apply {
            putDouble("received", received.toDouble())
            putDouble("total", total.toDouble())
        })
    }

    private fun installFile(file: File) {
        registerStatusReceiver()
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setSize(file.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Only honoured when we are the installer of record; otherwise the
                // system asks the user (STATUS_PENDING_USER_ACTION below).
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        try {
            installer.openSession(sessionId).use { session ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    file.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val intent = Intent(ACTION_STATUS).setPackage(context.packageName)
                var flags = PendingIntent.FLAG_UPDATE_CURRENT
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // The installer fills in EXTRA_STATUS, so the intent must stay mutable.
                    flags = flags or PendingIntent.FLAG_MUTABLE
                }
                val pending = PendingIntent.getBroadcast(context, sessionId, intent, flags)
                session.commit(pending.intentSender)
            }
        } catch (e: Exception) {
            installer.abandonSession(sessionId)
            throw e
        }
    }

    @Synchronized
    private fun registerStatusReceiver() {
        if (receiverRegistered) {
            return
        }
        ContextCompat.registerReceiver(
            context,
            statusReceiver,
            IntentFilter(ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
    }

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status"
            when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
                    if (confirm == null) {
                        finish { it.reject("failed", "No confirmation intent") }
                        return
                    }
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    try {
                        (context.currentActivity ?: context).startActivity(confirm)
                    } catch (e: Exception) {
                        finish { it.reject("failed", e.message, e) }
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> {
                    File(context.cacheDir, APK_NAME).delete()
                    finish { it.resolve(null) }
                }
                PackageInstaller.STATUS_FAILURE_ABORTED -> finish { it.reject("aborted", message) }
                // INSTALL_FAILED_UPDATE_INCOMPATIBLE (other signing key) maps to CONFLICT.
                PackageInstaller.STATUS_FAILURE_CONFLICT -> finish { it.reject("signature", message) }
                else -> {
                    val code = if (message.contains("signature", ignoreCase = true)) "signature" else "failed"
                    finish { it.reject(code, message) }
                }
            }
        }
    }
}

class SelfUpdatePackage : ReactPackage {
    @Suppress("OVERRIDE_DEPRECATION")
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(SelfUpdateModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
