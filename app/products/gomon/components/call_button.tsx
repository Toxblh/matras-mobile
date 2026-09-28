// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';

import OptionBox from '@components/option_box';
import {useServerUrl} from '@context/server';
import {fetchGomonChannelCall, joinGomonCall, startGomonCall} from '@gomon/actions';
import {useGomonState} from '@gomon/store';

import type {NavigationButtonProps} from '@components/navigation_button';

const messages = defineMessages({
    start: {id: 'gomon.start_call', defaultMessage: 'Call'},
    join: {id: 'gomon.join_call', defaultMessage: 'Join'},
});

/** Start the channel's gomon call, or join it when one is live. Undefined while the plugin is off. */
export const useGomonCallAction = (channelId: string) => {
    const intl = useIntl();
    const serverUrl = useServerUrl();
    const {pluginEnabled, calls} = useGomonState(serverUrl);
    const [busy, setBusy] = useState(false);
    const callId = calls[channelId];

    useEffect(() => {
        if (pluginEnabled && channelId) {
            fetchGomonChannelCall(serverUrl, channelId);
        }
    }, [pluginEnabled, serverUrl, channelId]);

    const onPress = useCallback(async () => {
        if (busy) {
            return;
        }
        setBusy(true);
        try {
            if (callId) {
                await joinGomonCall(intl, serverUrl, channelId, callId);
            } else {
                await startGomonCall(intl, serverUrl, channelId);
            }
        } finally {
            setBusy(false);
        }
    }, [busy, callId, intl, serverUrl, channelId]);

    return useMemo(() => {
        if (!pluginEnabled) {
            return undefined;
        }
        return {
            onPress,
            busy,
            live: Boolean(callId),
            text: intl.formatMessage(callId ? messages.join : messages.start),
        };
    }, [pluginEnabled, onPress, busy, callId, intl]);
};

export const useGomonHeaderButton = (channelId: string): NavigationButtonProps | undefined => {
    const action = useGomonCallAction(channelId);
    return useMemo(() => action && {
        id: 'gomon-call',
        iconName: action.live ? 'phone-in-talk' : 'video-outline',
        isLoading: action.busy,
        disabled: action.busy,
        onPress: action.onPress,
        accessibilityLabel: action.text,
        testID: 'channel_header.gomon_call.button',
    }, [action]);
};

// First in the channel actions row: keep the row's 8px gap.
const boxStyle = {marginRight: 8};

type BoxProps = {
    channelId: string;
    dismissChannelInfo?: () => void | Promise<unknown>;
};

export const GomonCallBox = ({channelId, dismissChannelInfo}: BoxProps) => {
    const action = useGomonCallAction(channelId);
    const onPress = useCallback(async () => {
        // Close the sheet / channel info first so it does not pop the call screen.
        await dismissChannelInfo?.();
        action?.onPress();
    }, [action, dismissChannelInfo]);

    if (!action) {
        return null;
    }
    return (
        <OptionBox
            onPress={onPress}
            text={action.text}
            iconName='video-outline'
            activeText={action.text}
            activeIconName='phone-in-talk'
            isActive={action.live}
            containerStyle={boxStyle}
            testID='channel_info.channel_actions.gomon_call.action'
        />
    );
};
