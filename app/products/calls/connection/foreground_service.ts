// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative from '@mattermost/calls-native';
import {defineMessages, type IntlShape} from 'react-intl';
import {Platform} from 'react-native';

import {General} from '@constants';
import DatabaseManager from '@database/manager';
import {getChannelById} from '@queries/servers/channel';
import {getCurrentUserId} from '@queries/servers/system';
import {getUserIdFromChannelName} from '@utils/user';

// Localized strings for the Android foreground-service notification. iOS
// doesn't use a foreground service; AVAudioSession + the `audio`
// background mode keep the mic alive on its own.
const messages = defineMessages({
    channelName: {
        id: 'mobile.calls.foreground_service.channel_name',
        defaultMessage: 'Mattermost Calls',
    },
    channelDescription: {
        id: 'mobile.calls.foreground_service.channel_description',
        defaultMessage: 'Keeps the microphone active while a call is in progress',
    },
    title: {
        id: 'mobile.calls.foreground_service.title',
        defaultMessage: 'Mattermost',
    },
    text: {
        id: 'mobile.calls.foreground_service.text',
        defaultMessage: 'Call in progress',
    },
});

// matras: name the call after who/where it is (DM partner, GM members, channel) and let
// the native side put the DM partner's avatar on the ongoing-call notification.
const describeCall = async (serverUrl: string, channelId: string) => {
    try {
        const {database} = DatabaseManager.getServerDatabaseAndOperator(serverUrl);
        const channel = await getChannelById(database, channelId);
        if (!channel) {
            return {};
        }
        let avatarUserId: string | undefined;
        if (channel.type === General.DM_CHANNEL) {
            avatarUserId = getUserIdFromChannelName(await getCurrentUserId(database), channel.name);
        }
        return {title: channel.displayName || undefined, avatarUserId};
    } catch {
        return {};
    }
};

export const foregroundServiceStart = async (intl: IntlShape, serverUrl?: string, channelId?: string) => {
    if (Platform.OS !== 'android') {
        return;
    }
    const call = serverUrl && channelId ? await describeCall(serverUrl, channelId) : {};
    CallsNative.foregroundServiceStart({
        channelId: 'calls_channel',
        channelName: intl.formatMessage(messages.channelName),
        channelDescription: intl.formatMessage(messages.channelDescription),
        title: call.title || intl.formatMessage(messages.title),
        text: intl.formatMessage(messages.text),
        ...(call.avatarUserId && serverUrl ? {serverUrl, avatarUserId: call.avatarUserId} : {}),
    });
};

export const foregroundServiceStop = () => {
    if (Platform.OS !== 'android') {
        return;
    }
    CallsNative.foregroundServiceStop();
};
