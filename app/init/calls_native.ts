// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type CallActionPayload, type VoIPTokenUpdated} from '@mattermost/calls-native';
import {defineMessages} from 'react-intl';
import {Alert, DeviceEventEmitter, Platform, type EmitterSubscription} from 'react-native';

const fullScreenMessages = defineMessages({
    title: {
        id: 'mobile.calls.full_screen_permission.title',
        defaultMessage: 'Allow full-screen calls',
    },
    body: {
        id: 'mobile.calls.full_screen_permission.body',
        defaultMessage: 'Android shows incoming calls only as a small notification until you allow full-screen notifications for this app.',
    },
    open: {
        id: 'mobile.calls.full_screen_permission.open',
        defaultMessage: 'Open settings',
    },
    later: {
        id: 'mobile.calls.full_screen_permission.later',
        defaultMessage: 'Not now',
    },
});

defineMessages({
    incomingCallPlaceholder: {
        id: 'mobile.ios.calls.incoming_call_placeholder',
        defaultMessage: '{applicationName} call',
    },
});

import {storeVoIPDeviceToken} from '@actions/app/global';
import {Device} from '@constants';
import {GOMON_LEAVE} from '@gomon/constants';
import {getCurrentGomonCall} from '@gomon/store';
import {DEFAULT_LOCALE} from '@i18n';
import {getIntlShape, isBetaApp} from '@utils/general';
import {logInfo} from '@utils/log';

// matras: Mattermost Calls is removed. What is left is the platform glue gomon uses:
// the full-screen-intent prompt, the iOS VoIP token and the Android ongoing-call "Hang up".
class CallsNativeSingleton {
    subscriptions?: EmitterSubscription[];

    init() {
        if (Platform.OS === 'android') {
            this.askForFullScreenCalls();
        }
        this.subscriptions?.forEach((s) => s.remove());
        this.subscriptions = [
            CallsNative.onVoIPTokenUpdated(this.onVoIPTokenUpdated),
            CallsNative.onCallAnswered(this.onCallAnswered),
            CallsNative.onCallEnded(this.onCallEnded),
        ];
    }

    // matras: without this permission the Android incoming call is only a heads-up
    // notification. Asked once per app launch while it is missing.
    private askForFullScreenCalls = async () => {
        try {
            if (await CallsNative.canUseFullScreenIntent()) {
                return;
            }
        } catch {
            return;
        }
        const intl = getIntlShape(DEFAULT_LOCALE);
        Alert.alert(
            intl.formatMessage(fullScreenMessages.title),
            intl.formatMessage(fullScreenMessages.body),
            [
                {text: intl.formatMessage(fullScreenMessages.later), style: 'cancel'},
                {text: intl.formatMessage(fullScreenMessages.open), onPress: () => CallsNative.openFullScreenIntentSettings()},
            ],
        );
    };

    cleanup() {
        this.subscriptions?.forEach((s) => s.remove());
        this.subscriptions = [];
    }

    private onVoIPTokenUpdated = async (event: VoIPTokenUpdated) => {
        const {token} = event;
        if (!token) {
            // Token invalidation: clear the stored value so the next
            // setExtraSessionProps call doesn't attach a stale token.
            await storeVoIPDeviceToken('');
            return;
        }

        let prefix = Device.PUSH_NOTIFY_APPLE_REACT_NATIVE;
        if (isBetaApp) {
            prefix = `${prefix}beta`;
        }
        const prefixed = `${prefix}-v2:${token}`;
        await storeVoIPDeviceToken(prefixed);
        logInfo('VoIP device token stored');
    };

    // iOS: a VoIP push still rings CallKit, but nothing here can join a Mattermost Calls
    // call any more. Close the native UI instead of leaving it on "Connecting…".
    private onCallAnswered = (event: CallActionPayload) => {
        CallsNative.reportEnded(event.uuid, 'failed');
    };

    // Android: "Hang up" on the ongoing-call notification.
    private onCallEnded = () => {
        if (Platform.OS === 'android' && getCurrentGomonCall()) {
            DeviceEventEmitter.emit(GOMON_LEAVE);
        }
    };
}

const CallsNativeInit = new CallsNativeSingleton();
export default CallsNativeInit;
