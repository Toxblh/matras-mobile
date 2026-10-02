// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {registerGlobals} from '@livekit/react-native';

// LiveKit's globals (DOMException, TextEncoder/Decoder, web streams, crypto.randomUUID…) are
// installed when the first native call opens, not at app start, so the rest of the app never
// depends on them. calls-native owns the audio session (CallKit on iOS, audio mode and routing
// on Android), exactly as for the WebView call.
registerGlobals({autoConfigureAudioSession: false});
