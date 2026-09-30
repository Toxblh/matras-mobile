// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type * as LiveKitRN from '@livekit/react-native';
import type * as LiveKitClient from 'livekit-client';

let loaded: {rn: typeof LiveKitRN; client: typeof LiveKitClient} | undefined;

/**
 * The SDK is loaded on the first native call only: importing it installs global polyfills
 * (TextEncoder, DOMException, streams, crypto.randomUUID…) that the default WebView path
 * must not depend on while the native call is a prototype.
 */
export function loadLiveKit() {
    if (!loaded) {
        const rn: typeof LiveKitRN = require('@livekit/react-native');

        // calls-native owns the audio session (CallKit on iOS, audio mode + routing on
        // Android), exactly as for the WebView call.
        rn.registerGlobals({autoConfigureAudioSession: false});
        loaded = {rn, client: require('livekit-client')};
    }
    return loaded;
}
