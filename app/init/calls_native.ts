// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type CallActionPayload, type IncomingCallPayload, type VoIPTokenUpdated} from '@mattermost/calls-native';
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
import DatabaseManager from '@database/manager';
import {acceptGomonFromPush, declineGomonFromPush} from '@gomon/actions';
import {isCurrentCallKitCall, setCallKitAnswered} from '@gomon/callkit';
import {GOMON_LEAVE} from '@gomon/constants';
import {initGomonTelecom} from '@gomon/native/android_telecom';
import {getCurrentGomonCall} from '@gomon/store';
import {DEFAULT_LOCALE} from '@i18n';
import {getCurrentUser} from '@queries/servers/user';
import {getIntlShape} from '@utils/general';
import {logInfo} from '@utils/log';
import {pushPlatformPrefix} from '@utils/push_platform';

// matras: Mattermost Calls is removed. What is left is the platform glue gomon uses:
// the full-screen-intent prompt, the iOS VoIP token and CallKit, the Android ongoing-call "Hang up".
class CallsNativeSingleton {
    subscriptions?: EmitterSubscription[];

    // iOS: CallKit calls rung by a VoIP push, until answered or declined.
    private rung = new Map<string, IncomingCallPayload>();

    init() {
        if (Platform.OS === 'android') {
            this.askForFullScreenCalls();
            initGomonTelecom();
        }
        this.subscriptions?.forEach((s) => s.remove());
        this.subscriptions = [
            CallsNative.onVoIPTokenUpdated(this.onVoIPTokenUpdated),
            CallsNative.onIncomingCall(this.onIncomingCall),
            CallsNative.onCallAnswered(this.onCallAnswered),
            CallsNative.onCallDeclined(this.onCallDeclined),
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

        const prefixed = `${pushPlatformPrefix()}-v2:${token}`;
        await storeVoIPDeviceToken(prefixed);
        logInfo('VoIP device token stored');
    };

    private onIncomingCall = (event: IncomingCallPayload) => {
        this.rung.set(event.uuid, event);
    };

    private takeRung = async (uuid: string) => {
        const rung = this.rung.get(uuid);
        this.rung.delete(uuid);
        const serverUrl = rung && await DatabaseManager.getServerUrlFromIdentifier(rung.serverId);
        return rung && serverUrl ? {serverUrl, channelId: rung.channelId} : undefined;
    };

    // iOS: "Answer" on the CallKit screen of a gomon VoIP push (sub_type comms_call) accepts
    // the invitation through the plugin; the call it opens adopts this CallKit call.
    private onCallAnswered = async ({uuid}: CallActionPayload) => {
        const rung = await this.takeRung(uuid);
        if (!rung) {
            CallsNative.reportEnded(uuid, 'failed');
            return;
        }
        const {serverUrl, channelId} = rung;
        setCallKitAnswered({uuid, serverUrl, channelId});
        const database = DatabaseManager.serverDatabases[serverUrl]?.database;
        const user = database ? await getCurrentUser(database) : undefined;
        await acceptGomonFromPush(getIntlShape(user?.locale), serverUrl, channelId);
        const call = getCurrentGomonCall();
        if (call?.serverUrl !== serverUrl || call.channelId !== channelId) {
            setCallKitAnswered(undefined);
            CallsNative.reportEnded(uuid, 'failed');
        }
    };

    private onCallDeclined = async ({uuid}: CallActionPayload) => {
        const rung = await this.takeRung(uuid);
        if (rung) {
            declineGomonFromPush(rung.serverUrl, rung.channelId);
        }
    };

    // "Hang up" on the Android ongoing-call notification or the iOS CallKit screen.
    private onCallEnded = ({uuid}: CallActionPayload) => {
        if (getCurrentGomonCall() && (Platform.OS === 'android' || isCurrentCallKitCall(uuid))) {
            DeviceEventEmitter.emit(GOMON_LEAVE);
        }
    };
}

const CallsNativeInit = new CallsNativeSingleton();
export default CallsNativeInit;
