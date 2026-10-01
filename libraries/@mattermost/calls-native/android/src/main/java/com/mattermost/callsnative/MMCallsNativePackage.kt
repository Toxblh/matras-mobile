package com.mattermost.callsnative

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class MMCallsNativePackage : TurboReactPackage() {
    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
        return when (name) {
            MMCallsNativeModuleImpl.NAME -> MMCallsNativeModule(reactContext)
            MMCallsPlatformModule.NAME -> MMCallsPlatformModule(reactContext)
            else -> null
        }
    }

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(
            MMCallsNativeModuleImpl.NAME to ReactModuleInfo(
                name = MMCallsNativeModuleImpl.NAME,
                className = MMCallsNativeModuleImpl.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                hasConstants = false,
                isCxxModule = false,
                isTurboModule = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
            ),
            // matras: Android-only, a plain bridge module (no codegen spec shared with iOS).
            MMCallsPlatformModule.NAME to ReactModuleInfo(
                name = MMCallsPlatformModule.NAME,
                className = MMCallsPlatformModule.NAME,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                hasConstants = false,
                isCxxModule = false,
                isTurboModule = false
            )
        )
    }
}
