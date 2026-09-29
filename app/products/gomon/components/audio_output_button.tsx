// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioDevice, type AudioDeviceType, type AudioRoute} from '@mattermost/calls-native';
import React, {useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CompassIcon, {type CompassIconName} from '@components/compass_icon';
import SlideUpPanelItem from '@components/slide_up_panel_item';
import {useTheme} from '@context/theme';

const messages = defineMessages({
    output: {id: 'gomon.audio_output', defaultMessage: 'Audio output'},
    EARPIECE: {id: 'mobile.calls_phone', defaultMessage: 'Phone'},
    SPEAKER_PHONE: {id: 'mobile.calls_speaker', defaultMessage: 'Speaker'},
    BLUETOOTH: {id: 'mobile.calls_bluetooth', defaultMessage: 'Bluetooth'},
    WIRED_HEADSET: {id: 'mobile.calls_headset', defaultMessage: 'Headset'},
});

const ICONS: Partial<Record<AudioDeviceType, CompassIconName>> = {
    EARPIECE: 'cellphone',
    SPEAKER_PHONE: 'volume-high',
    BLUETOOTH: 'bluetooth',
    WIRED_HEADSET: 'headphones',
};

const styles = StyleSheet.create({
    backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
    sheet: {borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingTop: 8},
});

type Props = {
    route: AudioRoute;
    onSelect: (device: AudioDeviceType) => void;
    style: StyleProp<ViewStyle>;
};

// A plain Modal, not the navigation bottom sheet: the call host sits above the
// navigation stack, so a bottom-sheet route would open under the expanded call.
const AudioOutputButton = ({route, onSelect, style}: Props) => {
    const intl = useIntl();
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const [open, setOpen] = useState(false);
    const close = () => setOpen(false);

    // Same list as the Calls picker: a plugged wired headset replaces the earpiece.
    let available = route.availableAudioDeviceList.filter((d) => ICONS[d]);
    if (available.includes(AudioDevice.WiredHeadset)) {
        available = available.filter((d) => d !== AudioDevice.Earpiece);
    }

    return (
        <>
            <Pressable
                onPress={() => setOpen(true)}
                style={style}
                accessibilityLabel={intl.formatMessage(messages.output)}
                testID='gomon_call.audio_output'
            >
                <CompassIcon
                    name={ICONS[route.selectedAudioDevice] ?? 'volume-high'}
                    size={24}
                    color='#fff'
                />
            </Pressable>
            <Modal
                transparent={true}
                visible={open}
                animationType='fade'
                onRequestClose={close}
                statusBarTranslucent={true}
                navigationBarTranslucent={true}
            >
                <Pressable
                    style={styles.backdrop}
                    onPress={close}
                >
                    <View style={[styles.sheet, {backgroundColor: theme.centerChannelBg, paddingBottom: insets.bottom + 8}]}>
                        {available.map((d) => (
                            <SlideUpPanelItem
                                key={d}
                                leftIcon={ICONS[d]}
                                text={intl.formatMessage(messages[d as keyof typeof messages])}
                                rightIcon={d === route.selectedAudioDevice ? 'check' : undefined}
                                rightIconStyles={{color: theme.buttonBg}}
                                onPress={() => {
                                    onSelect(d);
                                    close();
                                }}
                                testID={`gomon_call.audio_output.${d}`}
                            />
                        ))}
                    </View>
                </Pressable>
            </Modal>
        </>
    );
};

export default AudioOutputButton;
