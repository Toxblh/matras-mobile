package com.mattermost.rnbeta

import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.mattermost.callsnative.MMCallsPip
import com.mattermost.hardware.keyboard.MattermostHardwareKeyboardImpl
import com.mattermost.rnutils.helpers.FoldableObserver
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory;
import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
    private var HWKeyboardConnected = false
    private val foldableObserver = FoldableObserver.getInstance(this)
    private var lastOrientation: Int = Configuration.ORIENTATION_UNDEFINED

    /**
     * Returns the name of the main component registered from JavaScript. This is used to schedule
     * rendering of the component.
     */
    override fun getMainComponentName(): String = "Mattermost"

    /**
     * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
     * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
     */
    override fun createReactActivityDelegate(): ReactActivityDelegate =
        ReactActivityDelegateWrapper(this, BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
                DefaultReactActivityDelegate(this, mainComponentName, DefaultNewArchitectureEntryPoint.fabricEnabled))


    override fun onCreate(savedInstanceState: Bundle?) {
        supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
        super.onCreate(savedInstanceState)

        setHWKeyboardConnected()
        lastOrientation = this.resources.configuration.orientation
        foldableObserver.onCreate()
        WindowCompat.setDecorFitsSystemWindows(window, Build.VERSION.SDK_INT < Build.VERSION_CODES.R)
    }

    override fun onStart() {
        super.onStart()
        foldableObserver.onStart()
    }

    override fun onStop() {
        super.onStop()
        foldableObserver.onStop()
    }

    override fun onDestroy() {
        super.onDestroy()
        foldableObserver.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val newOrientation = newConfig.orientation
        if (newOrientation != lastOrientation) {
            lastOrientation = newOrientation
            foldableObserver.handleWindowLayoutInfo()
        }
        if (newConfig.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO) {
            HWKeyboardConnected = true
        } else if (newConfig.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_YES) {
            HWKeyboardConnected = false
        }
    }

    // matras: Picture-in-Picture of a gomon video call (MMCallsPip).
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        MMCallsPip.onUserLeaveHint(this)
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        // Closed (not expanded): the activity stays stopped.
        val dismissed = !isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED
        if (isInPictureInPictureMode) {
            keepReactResumed()
        } else if (dismissed) {
            (application as ReactApplication).reactHost?.onHostPause(this)
        }
        MMCallsPip.onModeChanged(this, isInPictureInPictureMode, dismissed)
    }

    override fun onPause() {
        super.onPause()
        if (isInPictureInPictureMode) {
            keepReactResumed()
        }
    }

    // A paused host stops Fabric's mounting (and JS timers): the PiP window would freeze on
    // whatever was mounted before. The window is visible, so React keeps running as resumed.
    private fun keepReactResumed() {
        (application as ReactApplication).reactHost?.onHostResume(this)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (HWKeyboardConnected) {
            val ok = MattermostHardwareKeyboardImpl.dispatchKeyEvent(event)
            if (ok) {
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    // Prebuilt react-android leaves ReactActivity's back callback disabled after
    // invokeDefaultOnBackPressed(). Re-enable it so back handling works after resume.
    // Remove when upgrading to React Native 0.84.0 or later.
    override fun invokeDefaultOnBackPressed() {
        super.invokeDefaultOnBackPressed()
        reactBackPressedCallback?.isEnabled = true
    }

    private val reactBackPressedCallback: OnBackPressedCallback? by lazy {
        try {
            val field = ReactActivity::class.java.getDeclaredField("mBackPressedCallback")
            field.isAccessible = true
            field.get(this) as? OnBackPressedCallback
        } catch (_: ReflectiveOperationException) {
            null
        }
    }

    private fun setHWKeyboardConnected() {
        HWKeyboardConnected = getResources().configuration.keyboard == Configuration.KEYBOARD_QWERTY
    }
}
