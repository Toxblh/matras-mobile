// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioDevice, type AudioDeviceType, type AudioRoute} from '@mattermost/calls-native';
import React, {useCallback} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Pressable, View, type StyleProp, type ViewStyle} from 'react-native';

import CompassIcon, {type CompassIconName} from '@components/compass_icon';
import SlideUpPanelItem, {ITEM_HEIGHT} from '@components/slide_up_panel_item';
import {useTheme} from '@context/theme';
import {bottomSheet, dismissBottomSheet} from '@screens/navigation';
import {bottomSheetSnapPoint} from '@utils/helpers';

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

type Props = {
    route: AudioRoute;
    onSelect: (device: AudioDeviceType) => void;
    style: StyleProp<ViewStyle>;
};

const AudioOutputButton = ({route, onSelect, style}: Props) => {
    const intl = useIntl();
    const theme = useTheme();

    const open = useCallback(() => {
        // Same list as the Calls picker: a plugged wired headset replaces the earpiece.
        let available = route.availableAudioDeviceList.filter((d) => ICONS[d]);
        if (available.includes(AudioDevice.WiredHeadset)) {
            available = available.filter((d) => d !== AudioDevice.Earpiece);
        }
        const renderContent = () => (
            <View>
                {available.map((d) => (
                    <SlideUpPanelItem
                        key={d}
                        leftIcon={ICONS[d]}
                        text={intl.formatMessage(messages[d as keyof typeof messages])}
                        rightIcon={d === route.selectedAudioDevice ? 'check' : undefined}
                        rightIconStyles={{color: theme.buttonBg}}
                        onPress={() => {
                            onSelect(d);
                            dismissBottomSheet();
                        }}
                        testID={`gomon_call.audio_output.${d}`}
                    />
                ))}
            </View>
        );
        bottomSheet(renderContent, [1, bottomSheetSnapPoint(available.length + 1, ITEM_HEIGHT)]);
    }, [intl, onSelect, route, theme.buttonBg]);

    return (
        <Pressable
            onPress={open}
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
    );
};

export default AudioOutputButton;
