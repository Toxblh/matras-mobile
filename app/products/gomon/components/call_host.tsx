// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, IntlProvider, useIntl} from 'react-intl';
import {Pressable, StyleSheet, View} from 'react-native';
import WebViewBase, {type WebViewMessageEvent, type WebViewProps} from 'react-native-webview';

import CompassIcon from '@components/compass_icon';
import {useGomonCallSession} from '@gomon/call_session';
import AudioOutputButton from '@gomon/components/audio_output_button';
import GomonCallLayout, {callStyles} from '@gomon/components/call_layout';
import GomonNativeCall from '@gomon/native/native_call';
import {type CurrentGomonCall, setCurrentGomonCall, useCurrentGomonCall} from '@gomon/store';
import {bridgeCommand, parseBridgeMessage, urlOrigin} from '@gomon/utils';
import {getTranslations} from '@i18n';
import {tryOpenURL} from '@utils/url';

import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';

// ponytail: the package's class typing is `Component<WebViewProps & undefined>` = never
// under strict null checks; re-type it until upstream fixes the default generic.
type WebViewHandle = {injectJavaScript: (script: string) => void};
const WebView = WebViewBase as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewHandle>>;

const messages = defineMessages({
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
});

// The page answers "leave" with comms:ended ~1.8 s later; close anyway if it does not.
const LEAVE_FALLBACK_MS = 4000;

const styles = StyleSheet.create({
    webview: {flex: 1, backgroundColor: '#000'},

    // Minimized: still mounted, attached and VISIBLE to Android (so Chromium keeps the page
    // visible and WebRTC running), only 1 px and transparent.
    webviewHidden: {position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0},
});

const GomonWebViewCall = ({call}: {call: CurrentGomonCall}) => {
    const {url, minimized} = call;
    const intl = useIntl();
    const webViewRef = useRef<WebViewHandle>(null);
    const closed = useRef(false);
    const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [state, setState] = useState<{mic: boolean; people: number}>();
    const origin = urlOrigin(url);

    const close = useCallback(() => {
        if (!closed.current) {
            closed.current = true;
            setCurrentGomonCall(undefined);
        }
    }, []);

    const leave = useCallback(() => {
        webViewRef.current?.injectJavaScript(bridgeCommand('leave'));
        clearTimeout(leaveTimer.current);
        leaveTimer.current = setTimeout(close, LEAVE_FALLBACK_MS);
    }, [close]);

    const {audio, selectAudio, reapplyRoute, now} = useGomonCallSession(call, leave);

    useEffect(() => () => clearTimeout(leaveTimer.current), []);

    const toggleMic = useCallback(() => {
        webViewRef.current?.injectJavaScript(bridgeCommand('mic'));
    }, []);

    const onMessage = useCallback((e: WebViewMessageEvent) => {
        const msg = parseBridgeMessage(e.nativeEvent.data);
        if (msg?.type === 'comms:state') {
            // ponytail: the WebView's WebRTC may reset the route when it opens the mic;
            // re-apply ours once on join. Hook every state message if that proves not enough.
            if (!state) {
                reapplyRoute();
            }
            setState({mic: msg.mic, people: msg.people});
        } else if (msg?.type === 'comms:ended') {
            close();
        }
    }, [close, state, reapplyRoute]);

    // Everything off the gomon origin goes to the system browser.
    const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
        const reqOrigin = urlOrigin(req.url);
        if (!reqOrigin || reqOrigin === origin) {
            return true;
        }
        tryOpenURL(req.url);
        return false;
    }, [origin]);

    const buttons = (
        <>
            {state &&
                <Pressable
                    onPress={toggleMic}
                    style={callStyles.button}
                    testID='gomon_call.mic'
                >
                    <CompassIcon
                        name={state.mic ? 'microphone' : 'microphone-off'}
                        size={24}
                        color='#fff'
                    />
                </Pressable>
            }
            {audio &&
                <AudioOutputButton
                    route={audio}
                    onSelect={selectAudio}
                    style={callStyles.button}
                />
            }
        </>
    );

    return (
        <GomonCallLayout
            call={call}
            people={state ? intl.formatMessage(messages.people, {count: state.people}) : ''}
            now={now}
            buttons={buttons}
            onLeave={leave}
        >
            <View
                collapsable={false}
                pointerEvents={minimized ? 'none' : 'auto'}
                style={minimized ? styles.webviewHidden : styles.webview}
            >
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
            </View>
        </GomonCallLayout>
    );
};

/** Mounted once above navigation: the active gomon call, full screen or as a floating bar. */
const GomonCallHost = () => {
    const call = useCurrentGomonCall();
    if (!call) {
        return null;
    }

    // The root IntlProvider has the default locale; the call carries its user's.
    return (
        <IntlProvider
            locale={call.locale}
            messages={getTranslations(call.locale)}
        >
            {call.native ? (
                <GomonNativeCall
                    key={call.startedAt}
                    call={call}
                />
            ) : (
                <GomonWebViewCall
                    key={call.startedAt}
                    call={call}
                />
            )}
        </IntlProvider>
    );
};

export default GomonCallHost;
