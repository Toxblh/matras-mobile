// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {defineMessages, type IntlShape} from 'react-intl';
import {Alert, AppState, DeviceEventEmitter} from 'react-native';

import {Screens} from '@constants';
import {SNACK_BAR_TYPE} from '@constants/snack_bar';
import DatabaseManager from '@database/manager';
import {GOMON_EVENTS, GOMON_INCOMING_CLOSED} from '@gomon/constants';
import {hasCameraPermission, hasMicrophonePermission} from '@gomon/permissions';
import {getCurrentGomonCall, setCurrentGomonCall, setGomonChannelCall, setGomonMinimized, setGomonPluginEnabled} from '@gomon/store';
import {buildEmbedUrl, isGomonPluginEnabled, isLiveState} from '@gomon/utils';
import NetworkManager from '@managers/network_manager';
import {getChannelById} from '@queries/servers/channel';
import {navigateToScreen} from '@screens/navigation';
import {getFullErrorMessage} from '@utils/errors';
import {logDebug, logWarning} from '@utils/log';
import {showSnackBar} from '@utils/snack_bar';

const messages = defineMessages({
    failed: {id: 'gomon.call_failed', defaultMessage: 'Could not connect to the call'},
    title: {id: 'gomon.call_title', defaultMessage: 'Call'},
    alreadyInCall: {id: 'gomon.already_in_call', defaultMessage: 'You are already in a call'},
});

// One call at a time: bring the active one back instead of starting another.
function expandActiveGomonCall(intl: IntlShape, serverUrl: string, channelId: string) {
    const call = getCurrentGomonCall();
    if (!call) {
        return false;
    }
    setGomonMinimized(false);
    if (call.serverUrl !== serverUrl || call.channelId !== channelId) {
        showSnackBar({barType: SNACK_BAR_TYPE.PLUGIN_TOAST, customMessage: intl.formatMessage(messages.alreadyInCall)});
    }
    return true;
}

async function channelTitle(serverUrl: string, channelId: string) {
    const database = DatabaseManager.serverDatabases[serverUrl]?.database;
    const channel = database ? await getChannelById(database, channelId) : undefined;
    return channel?.displayName || '';
}

export async function checkIsGomonPluginEnabled(serverUrl: string) {
    try {
        const manifests = await NetworkManager.getClient(serverUrl).getPluginsManifests();
        setGomonPluginEnabled(serverUrl, isGomonPluginEnabled(manifests));
    } catch (error) {
        logDebug('checkIsGomonPluginEnabled', error);
    }
}

export async function fetchGomonChannelCall(serverUrl: string, channelId: string) {
    try {
        const {call} = await NetworkManager.getClient(serverUrl).gomonGetChannelCall(channelId);
        setGomonChannelCall(serverUrl, channelId, call && isLiveState(call.state) ? call.call_id : undefined);
    } catch (error) {
        logDebug('fetchGomonChannelCall', error);
    }
}

export async function openGomonCall(intl: IntlShape, serverUrl: string, channelId: string, joinUrl: string, video: boolean, callId?: string) {
    if (expandActiveGomonCall(intl, serverUrl, channelId)) {
        return;
    }
    await hasMicrophonePermission();
    const withCamera = video && await hasCameraPermission(intl);
    const title = await channelTitle(serverUrl, channelId);

    // A second tap may have opened it while we waited for the permissions.
    if (expandActiveGomonCall(intl, serverUrl, channelId)) {
        return;
    }
    setCurrentGomonCall({
        serverUrl,
        channelId,
        callId,
        withCamera,
        url: buildEmbedUrl(joinUrl, !withCamera),
        locale: intl.locale,
        title: title || intl.formatMessage(messages.title),
        startedAt: Date.now(),
        minimized: false,
    });
}

const showFailure = (intl: IntlShape, error: unknown) => {
    logWarning('gomon call failed', getFullErrorMessage(error));
    Alert.alert(intl.formatMessage(messages.failed), getFullErrorMessage(error));
};

export async function startGomonCall(intl: IntlShape, serverUrl: string, channelId: string, video = true) {
    if (expandActiveGomonCall(intl, serverUrl, channelId)) {
        return;
    }
    try {
        const res = await NetworkManager.getClient(serverUrl).gomonStartCall(channelId, video);
        setGomonChannelCall(serverUrl, channelId, res.call_id);
        await openGomonCall(intl, serverUrl, channelId, res.join_url, video, res.call_id);
    } catch (error) {
        showFailure(intl, error);
    }
}

export async function joinGomonCall(intl: IntlShape, serverUrl: string, channelId: string, callId: string, video = true) {
    if (expandActiveGomonCall(intl, serverUrl, channelId)) {
        return;
    }
    try {
        const res = await NetworkManager.getClient(serverUrl).gomonJoinCall(callId);
        await openGomonCall(intl, serverUrl, channelId, res.join_url, video, callId);
    } catch (error) {
        showFailure(intl, error);
    }
}

export async function acceptGomonInvitation(intl: IntlShape, serverUrl: string, invitationId: string, channelId: string, callId: string, video: boolean) {
    try {
        const res = await NetworkManager.getClient(serverUrl).gomonInvitation(invitationId, 'accept');
        if (res.join_url) {
            await openGomonCall(intl, serverUrl, channelId, res.join_url, video, callId);
        }
    } catch (error) {
        showFailure(intl, error);
    }
}

export async function declineGomonInvitation(serverUrl: string, invitationId: string) {
    try {
        await NetworkManager.getClient(serverUrl).gomonInvitation(invitationId, 'decline');
    } catch (error) {
        logDebug('declineGomonInvitation', error);
    }
}

// Push "Answer": only the channel is known. The rung invitation may be gone (404/409),
// then join the live call directly if there is one.
export async function acceptGomonFromPush(intl: IntlShape, serverUrl: string, channelId: string) {
    if (expandActiveGomonCall(intl, serverUrl, channelId)) {
        return;
    }
    const client = NetworkManager.getClient(serverUrl);
    try {
        const res = await client.gomonChannelInvitation(channelId, 'accept');
        if (res.join_url) {
            await openGomonCall(intl, serverUrl, channelId, res.join_url, true);
            return;
        }
    } catch (error) {
        logDebug('acceptGomonFromPush: accept failed, trying to join', error);
    }
    try {
        const {call} = await client.gomonGetChannelCall(channelId);
        if (call && isLiveState(call.state)) {
            await joinGomonCall(intl, serverUrl, channelId, call.call_id);
        }
    } catch (error) {
        logDebug('acceptGomonFromPush', error);
    }
}

export async function declineGomonFromPush(serverUrl: string, channelId: string) {
    try {
        await NetworkManager.getClient(serverUrl).gomonChannelInvitation(channelId, 'decline');
    } catch (error) {
        logDebug('declineGomonFromPush', error);
    }
}

type IncomingData = {invitation_id: string; call_id: string; inviter_name?: string; channel_id?: string; state?: string};
type CallStateData = {call_id: string; channel_id: string; state: string};

// ponytail: grows by one id per incoming call for the app lifetime; negligible.
const seenInvitations = new Set<string>();

export function handleGomonEvents(serverUrl: string, msg: WebSocketMessage) {
    switch (msg.event) {
        case GOMON_EVENTS.INCOMING: {
            const data = msg.data as IncomingData;
            if (!data?.invitation_id || seenInvitations.has(data.invitation_id)) {
                return;
            }

            // In the background the push shows the system incoming-call UI instead.
            if (AppState.currentState !== 'active' || getCurrentGomonCall()) {
                return;
            }
            seenInvitations.add(data.invitation_id);
            if (data.state === 'DISPATCHING') {
                NetworkManager.getClient(serverUrl).gomonInvitation(data.invitation_id, 'ack').catch((e: unknown) => logDebug('gomon ack', e));
            }
            navigateToScreen(Screens.GOMON_INCOMING, {
                serverUrl,
                invitationId: data.invitation_id,
                channelId: data.channel_id ?? '',
                callId: data.call_id,
                callerName: data.inviter_name ?? '',
            });
            return;
        }
        case GOMON_EVENTS.INCOMING_CLOSED:
            DeviceEventEmitter.emit(GOMON_INCOMING_CLOSED, (msg.data as IncomingData)?.invitation_id);
            return;
        case GOMON_EVENTS.CALL_STATE:
        case GOMON_EVENTS.MY_CALL: {
            const data = msg.data as CallStateData;
            if (data?.channel_id) {
                setGomonChannelCall(serverUrl, data.channel_id, isLiveState(data.state) ? data.call_id : undefined);
            }
        }
    }
}
