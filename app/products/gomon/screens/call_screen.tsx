// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, DeviceEventEmitter, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import WebViewBase, {type WebViewMessageEvent, type WebViewProps} from 'react-native-webview';

import {foregroundServiceStart, foregroundServiceStop} from '@calls/connection/foreground_service';
import CompassIcon from '@components/compass_icon';
import {Screens} from '@constants';
import {GOMON_LEAVE} from '@gomon/constants';
import {setCurrentGomonCall} from '@gomon/store';
import {bridgeCommand, parseBridgeMessage, urlOrigin} from '@gomon/utils';
import useAndroidHardwareBackHandler from '@hooks/android_back_handler';
import {navigateBack} from '@screens/navigation';
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

    useEffect(() => {
        setCurrentGomonCall({serverUrl, channelId, callId});
        foregroundServiceStart(intl, withCamera, serverUrl, channelId);

        // "Hang up" on the ongoing-call notification (calls_native.ts).
        const sub = DeviceEventEmitter.addListener(GOMON_LEAVE, leave);
        return () => {
            sub.remove();
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
            setState({mic: msg.mic, people: msg.people});
        } else if (msg?.type === 'comms:ended') {
            close();
        }
    }, [close]);

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
