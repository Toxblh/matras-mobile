// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative from '@mattermost/calls-native';
import React, {useCallback, useEffect, useRef} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {DeviceEventEmitter, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import CompassIcon, {type CompassIconName} from '@components/compass_icon';
import {Calls, Screens} from '@constants';
import {acceptGomonInvitation, declineGomonInvitation} from '@gomon/actions';
import {GOMON_INCOMING_CLOSED} from '@gomon/constants';
import useAndroidHardwareBackHandler from '@hooks/android_back_handler';
import {navigateBack} from '@screens/navigation';

export type GomonIncomingProps = {
    serverUrl: string;
    invitationId: string;
    channelId: string;
    callId: string;
    callerName: string;
};

const messages = defineMessages({
    incoming: {id: 'gomon.incoming_call', defaultMessage: 'Incoming call'},
    accept: {id: 'gomon.accept', defaultMessage: 'Accept'},
    audioOnly: {id: 'gomon.accept_audio', defaultMessage: 'Audio only'},
    decline: {id: 'gomon.decline', defaultMessage: 'Decline'},
});

const styles = StyleSheet.create({
    container: {flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'space-between', padding: 24},
    header: {alignItems: 'center', marginTop: 80, gap: 12},
    caller: {color: '#fff', fontSize: 28, fontWeight: '600', textAlign: 'center'},
    subtitle: {color: '#ccc', fontSize: 16},
    actions: {flexDirection: 'row', justifyContent: 'space-around', marginBottom: 40},
    action: {alignItems: 'center', gap: 8},
    circle: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
    label: {color: '#fff', fontSize: 14},
});

const Action = ({icon, color, label, onPress, testID}: {icon: CompassIconName; color: string; label: string; onPress: () => void; testID: string}) => (
    <Pressable
        onPress={onPress}
        style={styles.action}
        testID={testID}
    >
        <View style={[styles.circle, {backgroundColor: color}]}>
            <CompassIcon
                name={icon}
                size={32}
                color='#fff'
            />
        </View>
        <Text style={styles.label}>{label}</Text>
    </Pressable>
);

const GomonIncomingScreen = ({serverUrl, invitationId, channelId, callId, callerName}: GomonIncomingProps) => {
    const intl = useIntl();
    const done = useRef(false);

    // Stops the ringtone and closes the screen exactly once.
    const finish = useCallback(async () => {
        if (done.current) {
            return false;
        }
        done.current = true;
        if (Platform.OS === 'android') {
            CallsNative.stopRingtone();
        }
        await navigateBack();
        return true;
    }, []);

    useEffect(() => {
        if (Platform.OS === 'android') {
            CallsNative.startRingtone('calls_' + Calls.RINGTONE_DEFAULT.toLowerCase(), Calls.RING_LENGTH / 1000, false);
        }
        const timeout = setTimeout(finish, Calls.RING_LENGTH);
        const sub = DeviceEventEmitter.addListener(GOMON_INCOMING_CLOSED, (id?: string) => {
            if (!id || id === invitationId) {
                finish();
            }
        });
        return () => {
            clearTimeout(timeout);
            sub.remove();
            if (!done.current && Platform.OS === 'android') {
                CallsNative.stopRingtone();
            }
        };
    }, [finish, invitationId]);

    const accept = useCallback(async (video: boolean) => {
        if (await finish()) {
            acceptGomonInvitation(intl, serverUrl, invitationId, channelId, callId, video);
        }
    }, [finish, intl, serverUrl, invitationId, channelId, callId]);

    const decline = useCallback(async () => {
        if (await finish()) {
            declineGomonInvitation(serverUrl, invitationId);
        }
    }, [finish, serverUrl, invitationId]);

    useAndroidHardwareBackHandler(Screens.GOMON_INCOMING, decline);

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.subtitle}>{intl.formatMessage(messages.incoming)}</Text>
                <Text style={styles.caller}>{callerName}</Text>
            </View>
            <View style={styles.actions}>
                <Action
                    icon='phone-hangup'
                    color='#d24b4e'
                    label={intl.formatMessage(messages.decline)}
                    onPress={decline}
                    testID='gomon_incoming.decline'
                />
                <Action
                    icon='phone'
                    color='#3db887'
                    label={intl.formatMessage(messages.audioOnly)}
                    onPress={() => accept(false)}
                    testID='gomon_incoming.audio'
                />
                <Action
                    icon='video-outline'
                    color='#3db887'
                    label={intl.formatMessage(messages.accept)}
                    onPress={() => accept(true)}
                    testID='gomon_incoming.accept'
                />
            </View>
        </SafeAreaView>
    );
};

export default GomonIncomingScreen;
