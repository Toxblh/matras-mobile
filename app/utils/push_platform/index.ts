// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {applicationId} from 'expo-application';
import {Platform} from 'react-native';

import {Device} from '@constants';

/** matras: the iOS bundle id served by our own push proxy (docs/push-proxy.md). */
export const MATRAS_APP_ID = 'ru.toxblh.matras';

/**
 * The device id prefix the push proxy routes by, for the standard and the VoIP token alike:
 * `apple_matras` for our bundle, `apple_rnbeta` / `apple_rn` for Mattermost's. Android keeps
 * `android_rn` until it moves to its own Firebase project.
 */
export function pushPlatformPrefix(os = Platform.OS, appId: string | null = applicationId) {
    if (os !== 'ios') {
        return Device.PUSH_NOTIFY_ANDROID_REACT_NATIVE;
    }
    if (appId === MATRAS_APP_ID) {
        return 'apple_matras';
    }
    return appId?.includes('rnbeta') ? `${Device.PUSH_NOTIFY_APPLE_REACT_NATIVE}beta` : Device.PUSH_NOTIFY_APPLE_REACT_NATIVE;
}
