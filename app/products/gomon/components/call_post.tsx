// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Pressable, Text, View} from 'react-native';

import CompassIcon from '@components/compass_icon';
import {useServerUrl} from '@context/server';
import {useTheme} from '@context/theme';
import {joinGomonCall} from '@gomon/actions';
import {GOMON_POST_TYPE} from '@gomon/constants';
import {isLiveState} from '@gomon/utils';
import {changeOpacity, makeStyleSheetFromTheme} from '@utils/theme';
import {typography} from '@utils/typography';
import {tryOpenURL} from '@utils/url';

import type PostModel from '@typings/database/models/servers/post';

const messages = defineMessages({
    live: {id: 'gomon.post.live', defaultMessage: 'Call in progress'},
    ended: {id: 'gomon.post.ended', defaultMessage: 'Call ended'},
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
    missed: {id: 'gomon.post.missed', defaultMessage: 'Did not join: {names}'},
    join: {id: 'gomon.join_call', defaultMessage: 'Join'},
    recording: {id: 'gomon.post.recording', defaultMessage: 'Recording'},
});

export const isGomonCallPost = (post: PostModel) => (post.type as string) === GOMON_POST_TYPE;

const getStyleSheet = makeStyleSheetFromTheme((theme: Theme) => ({
    card: {
        borderWidth: 1,
        borderColor: changeOpacity(theme.centerChannelColor, 0.16),
        borderRadius: 4,
        padding: 12,
        gap: 4,
        marginTop: 4,
    },
    row: {flexDirection: 'row', alignItems: 'center', gap: 8},
    title: {color: theme.centerChannelColor, ...typography('Heading', 200)},
    text: {color: changeOpacity(theme.centerChannelColor, 0.72), ...typography('Body', 100)},
    buttons: {flexDirection: 'row', gap: 8, marginTop: 8},
    join: {backgroundColor: theme.onlineIndicator, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 16},
    joinText: {color: '#fff', ...typography('Body', 100, 'SemiBold')},
    link: {borderRadius: 4, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: changeOpacity(theme.buttonBg, 0.08)},
    linkText: {color: theme.buttonBg, ...typography('Body', 100, 'SemiBold')},
}));

const GomonCallPost = ({post}: {post: PostModel}) => {
    const intl = useIntl();
    const theme = useTheme();
    const styles = getStyleSheet(theme);
    const serverUrl = useServerUrl();
    const [joining, setJoining] = useState(false);

    const props = post.props || {};
    const callId = String(props.call_id ?? '');
    const live = isLiveState(props.state);
    const count = Number(props.participants) || 0;
    const names = String(props.participant_names ?? '');
    const missed = String(props.missed ?? '').split(',').map((m) => m.split(':')[0].trim()).filter(Boolean).join(', ');
    const recordingUrl = typeof props.recording_url === 'string' ? props.recording_url : '';

    const join = useCallback(async () => {
        setJoining(true);
        try {
            await joinGomonCall(intl, serverUrl, post.channelId, callId);
        } finally {
            setJoining(false);
        }
    }, [intl, serverUrl, post.channelId, callId]);

    const openRecording = useCallback(() => tryOpenURL(recordingUrl), [recordingUrl]);

    return (
        <View style={styles.card}>
            <View style={styles.row}>
                <CompassIcon
                    name={live ? 'phone-in-talk' : 'phone-hangup'}
                    size={20}
                    color={live ? theme.onlineIndicator : changeOpacity(theme.centerChannelColor, 0.56)}
                />
                <Text style={styles.title}>{intl.formatMessage(live ? messages.live : messages.ended)}</Text>
            </View>
            {live && count > 0 &&
                <Text style={styles.text}>{`${intl.formatMessage(messages.people, {count})}${names ? `: ${names}` : ''}`}</Text>
            }
            {!live && Boolean(missed) &&
                <Text style={styles.text}>{intl.formatMessage(messages.missed, {names: missed})}</Text>
            }
            {(live || Boolean(recordingUrl)) &&
                <View style={styles.buttons}>
                    {live && Boolean(callId) &&
                        <Pressable
                            onPress={join}
                            disabled={joining}
                            style={styles.join}
                            testID='gomon_post.join'
                        >
                            <Text style={styles.joinText}>{intl.formatMessage(messages.join)}</Text>
                        </Pressable>
                    }
                    {Boolean(recordingUrl) &&
                        <Pressable
                            onPress={openRecording}
                            style={styles.link}
                            testID='gomon_post.recording'
                        >
                            <Text style={styles.linkText}>{intl.formatMessage(messages.recording)}</Text>
                        </Pressable>
                    }
                </View>
            }
        </View>
    );
};

export default GomonCallPost;
