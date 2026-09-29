// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type AudioDeviceType, type AudioRoute} from '@mattermost/calls-native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, DeviceEventEmitter, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import WebViewBase, {type WebViewMessageEvent, type WebViewProps} from 'react-native-webview';

import {foregroundServiceStart, foregroundServiceStop} from '@calls/connection/foreground_service';
import CompassIcon from '@components/compass_icon';
import {Screens} from '@constants';
import AudioOutputButton from '@gomon/components/audio_output_button';
import {GOMON_LEAVE} from '@gomon/constants';
import {setCurrentGomonCall} from '@gomon/store';
import {bridgeCommand, nextAudioRoute, parseBridgeMessage, urlOrigin} from '@gomon/utils';
import useAndroidHardwareBackHandler from '@hooks/android_back_handler';
import {navigateBack} from '@screens/navigation';
import {logWarning} from '@utils/log';
import {tryOpenURL} from '@utils/url';

import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';

// ponytail: the package's class typing is `Component<WebViewProps & undefined>` = never
// under strict null checks; re-type it until upstream fixes the default generic.
type WebViewHandle = {injectJavaScript: (script: string) => void};
const WebView = WebViewBase as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewHandle>>;

export type GomonCallProps = {
    serverUrl: string;
    channelId: string;
    callId?: string;
    url: string;
    withCamera?: boolean;
};

const messages = defineMessages({
    title: {id: 'gomon.call_title', defaultMessage: 'Call'},
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
    leaveTitle: {id: 'gomon.leave_title', defaultMessage: 'Leave the call?'},
    leave: {id: 'gomon.leave', defaultMessage: 'Leave'},
    cancel: {id: 'gomon.cancel', defaultMessage: 'Cancel'},
});

// The page answers "leave" with comms:ended ~1.8 s later; close anyway if it does not.
const LEAVE_FALLBACK_MS = 4000;

const styles = StyleSheet.create({
    container: {flex: 1, backgroundColor: '#000'},
    bar: {height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8},
    title: {flex: 1, color: '#fff', fontSize: 16, fontWeight: '600'},
    button: {padding: 6},
    webview: {flex: 1, backgroundColor: '#000'},
});

const GomonCallScreen = ({serverUrl, channelId, callId, url, withCamera = false}: GomonCallProps) => {
    const intl = useIntl();
    const webViewRef = useRef<WebViewHandle>(null);
    const closed = useRef(false);
    const [state, setState] = useState<{mic: boolean; people: number}>();
    const [audio, setAudio] = useState<AudioRoute>();
    const audioRef = useRef<AudioRoute | undefined>(undefined);
    const pinnedRoute = useRef<AudioDeviceType | undefined>(undefined);
    const wantedRoute = useRef<AudioDeviceType | undefined>(undefined);
    const origin = urlOrigin(url);

    const close = useCallback(() => {
        if (!closed.current) {
            closed.current = true;
            navigateBack();
        }
    }, []);

    const leave = useCallback(() => {
        webViewRef.current?.injectJavaScript(bridgeCommand('leave'));
        setTimeout(close, LEAVE_FALLBACK_MS);
    }, [close]);

    const askLeave = useCallback(() => {
        Alert.alert(intl.formatMessage(messages.leaveTitle), undefined, [
            {text: intl.formatMessage(messages.cancel), style: 'cancel'},
            {text: intl.formatMessage(messages.leave), style: 'destructive', onPress: leave},
        ]);
    }, [intl, leave]);

    const toggleMic = useCallback(() => {
        webViewRef.current?.injectJavaScript(bridgeCommand('mic'));
    }, []);

    const selectAudio = useCallback((device: AudioDeviceType) => {
        pinnedRoute.current = device;
        wantedRoute.current = device;
        CallsNative.setAudioRoute(device);
    }, []);

    useEffect(() => {
        setCurrentGomonCall({serverUrl, channelId, callId});
        foregroundServiceStart(intl, withCamera, serverUrl, channelId);

        // Voice-call audio session (MODE_IN_COMMUNICATION + focus), shared with Calls,
        // so the WebView's WebRTC audio can be routed to earpiece / headset / speaker.
        const onRoute = (route: AudioRoute) => {
            const available = route.availableAudioDeviceList;
            const next = nextAudioRoute(available, audioRef.current?.availableAudioDeviceList ?? [], route.selectedAudioDevice, pinnedRoute.current, withCamera);
            if (pinnedRoute.current && !available.includes(pinnedRoute.current)) {
                pinnedRoute.current = undefined;
            }
            audioRef.current = route;
            setAudio(route);
            if (next) {
                wantedRoute.current = next;
            }
            if (next && next !== route.selectedAudioDevice) {
                CallsNative.setAudioRoute(next);
            }
        };
        const routeSub = CallsNative.onAudioRouteChanged(onRoute);
        CallsNative.startAudioSession().
            then(() => CallsNative.getAudioRoute()).
            then(onRoute).
            catch((e) => logWarning('gomon: audio session', e));

        // "Hang up" on the ongoing-call notification (calls_native.ts).
        const sub = DeviceEventEmitter.addListener(GOMON_LEAVE, leave);
        return () => {
            sub.remove();
            routeSub.remove();
            CallsNative.stopAudioSession();
            foregroundServiceStop();
            setCurrentGomonCall(undefined);
        };

    // Once per screen: the call does not change under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useAndroidHardwareBackHandler(Screens.GOMON_CALL, askLeave);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
        const msg = parseBridgeMessage(e.nativeEvent.data);
        if (msg?.type === 'comms:state') {
            // ponytail: the WebView's WebRTC may reset the route when it opens the mic;
            // re-apply ours once on join. Hook every state message if that proves not enough.
            if (!state && wantedRoute.current) {
                CallsNative.setAudioRoute(wantedRoute.current);
            }
            setState({mic: msg.mic, people: msg.people});
        } else if (msg?.type === 'comms:ended') {
            close();
        }
    }, [close, state]);

    // Everything off the gomon origin goes to the system browser.
    const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
        const reqOrigin = urlOrigin(req.url);
        if (!reqOrigin || reqOrigin === origin) {
            return true;
        }
        tryOpenURL(req.url);
        return false;
    }, [origin]);

    let title = intl.formatMessage(messages.title);
    if (state) {
        title = `${title} · ${intl.formatMessage(messages.people, {count: state.people})}`;
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.bar}>
                <Pressable
                    onPress={askLeave}
                    style={styles.button}
                    accessibilityLabel={intl.formatMessage(messages.leave)}
                    testID='gomon_call.leave'
                >
                    <CompassIcon
                        name='close'
                        size={24}
                        color='#fff'
                    />
                </Pressable>
                <Text
                    style={styles.title}
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {audio &&
                    <AudioOutputButton
                        route={audio}
                        onSelect={selectAudio}
                        style={styles.button}
                    />
                }
                {state &&
                    <Pressable
                        onPress={toggleMic}
                        style={styles.button}
                        testID='gomon_call.mic'
                    >
                        <CompassIcon
                            name={state.mic ? 'microphone' : 'microphone-off'}
                            size={24}
                            color='#fff'
                        />
                    </Pressable>
                }
            </View>
            <WebView
                ref={webViewRef}
                source={{uri: url}}
                style={styles.webview}
                javaScriptEnabled={true}
                domStorageEnabled={true}
                mediaPlaybackRequiresUserAction={false}
                allowsInlineMediaPlayback={true}
                mediaCapturePermissionGrantType='grantIfSameHostElsePrompt'
                setSupportMultipleWindows={false}
                onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
                onMessage={onMessage}
            />
        </SafeAreaView>
    );
};

export default GomonCallScreen;
