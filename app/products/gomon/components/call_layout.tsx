// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, type ReactNode} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CompassIcon from '@components/compass_icon';
import {SNACK_BAR_TYPE} from '@constants/snack_bar';
import {toggleGomonNative} from '@gomon/native/flag';
import {type CurrentGomonCall, setGomonMinimized} from '@gomon/store';
import {formatCallDuration} from '@gomon/utils';
import {useDefaultHeaderHeight} from '@hooks/header';
import {showSnackBar} from '@utils/snack_bar';

const messages = defineMessages({
    leaveTitle: {id: 'gomon.leave_title', defaultMessage: 'Leave the call?'},
    leave: {id: 'gomon.leave', defaultMessage: 'Leave'},
    cancel: {id: 'gomon.cancel', defaultMessage: 'Cancel'},
    minimize: {id: 'gomon.minimize', defaultMessage: 'Minimize'},
    hangUp: {id: 'gomon.hang_up', defaultMessage: 'End call'},
    expand: {id: 'gomon.return_to_call', defaultMessage: 'Return to call'},
    nativeOn: {id: 'gomon.native_on', defaultMessage: 'Native calls: on from the next call'},
    nativeOff: {id: 'gomon.native_off', defaultMessage: 'Native calls: off from the next call'},
});

export const callStyles = StyleSheet.create({
    button: {padding: 6},
    hangUp: {padding: 6, borderRadius: 18, backgroundColor: '#d24b4e'},
});

const styles = StyleSheet.create({
    expanded: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
    minimized: {position: 'absolute', left: 8, right: 8},
    bar: {height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8},
    title: {flex: 1, color: '#fff', fontSize: 16, fontWeight: '600'},
    mini: {height: 48, borderRadius: 8, backgroundColor: '#1e325c', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, elevation: 4},
    miniText: {flex: 1, marginLeft: 4},
    miniTitle: {color: '#fff', fontSize: 14, fontWeight: '600'},
    miniSub: {color: 'rgba(255,255,255,0.72)', fontSize: 12},
});

type Props = {
    call: CurrentGomonCall;

    /** "3 participants", empty until known. */
    people: string;
    now: number;

    /** Mic, audio output… shown in both presentations before "End call". */
    buttons: ReactNode;
    onLeave: () => void;

    /** The media; stays mounted in both presentations. */
    children: ReactNode;
};

/** A gomon call full screen (bar on top of the media) or minimized to a floating bar. */
const GomonCallLayout = ({call, people, now, buttons, onLeave, children}: Props) => {
    const {minimized, title, startedAt} = call;
    const intl = useIntl();
    const insets = useSafeAreaInsets();
    const headerHeight = useDefaultHeaderHeight();

    const minimize = useCallback(() => setGomonMinimized(true), []);
    const expand = useCallback(() => setGomonMinimized(false), []);

    const askLeave = useCallback(() => {
        Alert.alert(intl.formatMessage(messages.leaveTitle), undefined, [
            {text: intl.formatMessage(messages.cancel), style: 'cancel'},
            {text: intl.formatMessage(messages.leave), style: 'destructive', onPress: onLeave},
        ]);
    }, [intl, onLeave]);

    // Hidden switch for the native (LiveKit) call prototype.
    const toggleNative = useCallback(async () => {
        const on = await toggleGomonNative();
        showSnackBar({barType: SNACK_BAR_TYPE.PLUGIN_TOAST, customMessage: intl.formatMessage(on ? messages.nativeOn : messages.nativeOff)});
    }, [intl]);

    const duration = formatCallDuration(now - startedAt);

    // The media keeps its slot and parents in both presentations, so React never remounts
    // it; collapsable={false} keeps Fabric from re-parenting it natively on style changes.
    return (
        <View
            collapsable={false}
            pointerEvents='box-none'
            style={minimized ? [styles.minimized, {top: headerHeight + 8}] : [styles.expanded, {paddingTop: insets.top, paddingBottom: insets.bottom}]}
        >
            {!minimized &&
                <View style={styles.bar}>
                    <Pressable
                        onPress={minimize}
                        style={callStyles.button}
                        accessibilityLabel={intl.formatMessage(messages.minimize)}
                        testID='gomon_call.minimize'
                    >
                        <CompassIcon
                            name='chevron-down'
                            size={24}
                            color='#fff'
                        />
                    </Pressable>
                    <Text
                        style={styles.title}
                        numberOfLines={1}
                        onLongPress={toggleNative}
                    >
                        {people ? `${title} · ${people}` : title}
                    </Text>
                    {buttons}
                    <Pressable
                        onPress={askLeave}
                        style={callStyles.hangUp}
                        accessibilityLabel={intl.formatMessage(messages.hangUp)}
                        testID='gomon_call.leave'
                    >
                        <CompassIcon
                            name='phone-hangup'
                            size={24}
                            color='#fff'
                        />
                    </Pressable>
                </View>
            }
            {children}
            {minimized &&
                <Pressable
                    onPress={expand}
                    style={styles.mini}
                    accessibilityLabel={intl.formatMessage(messages.expand)}
                    testID='gomon_call.bar'
                >
                    <CompassIcon
                        name='phone-in-talk'
                        size={20}
                        color='#3db887'
                    />
                    <View style={styles.miniText}>
                        <Text
                            style={styles.miniTitle}
                            numberOfLines={1}
                        >
                            {title}
                        </Text>
                        <Text
                            style={styles.miniSub}
                            numberOfLines={1}
                        >
                            {people ? `${duration} · ${people}` : duration}
                        </Text>
                    </View>
                    {buttons}
                    <Pressable
                        onPress={onLeave}
                        style={callStyles.hangUp}
                        accessibilityLabel={intl.formatMessage(messages.hangUp)}
                        testID='gomon_call.bar.hang_up'
                    >
                        <CompassIcon
                            name='phone-hangup'
                            size={20}
                            color='#fff'
                        />
                    </Pressable>
                </Pressable>
            }
        </View>
    );
};

export default GomonCallLayout;
