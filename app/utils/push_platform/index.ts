// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {applicationId} from 'expo-application';
import {Platform} from 'react-native';

import {Device} from '@constants';

/** matras: the app id (iOS bundle, Android applicationId) served by our own push proxy (docs/push-proxy.md). */
export const MATRAS_APP_ID = 'ru.toxblh.matras';

/**
 * The device id prefix the push proxy routes by, for the standard and the VoIP token alike:
 * `apple_matras` / `android_matras` for our app id (our Firebase project and APNs key),
 * `apple_rnbeta` / `apple_rn` / `android_rn` for Mattermost's.
 */
export function pushPlatformPrefix(os = Platform.OS, appId: string | null = applicationId) {
    if (appId === MATRAS_APP_ID) {
        return os === 'ios' ? 'apple_matras' : 'android_matras';
    }
    if (os !== 'ios') {
        return Device.PUSH_NOTIFY_ANDROID_REACT_NATIVE;
    }
    return appId?.includes('rnbeta') ? `${Device.PUSH_NOTIFY_APPLE_REACT_NATIVE}beta` : Device.PUSH_NOTIFY_APPLE_REACT_NATIVE;
}
