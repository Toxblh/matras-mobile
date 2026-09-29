// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type AudioDeviceType, type AudioRoute} from '@mattermost/calls-native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, IntlProvider, useIntl} from 'react-intl';
import {Alert, BackHandler, DeviceEventEmitter, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import WebViewBase, {type WebViewMessageEvent, type WebViewProps} from 'react-native-webview';

import {foregroundServiceStart, foregroundServiceStop} from '@calls/connection/foreground_service';
import CompassIcon from '@components/compass_icon';
import AudioOutputButton from '@gomon/components/audio_output_button';
import {GOMON_LEAVE} from '@gomon/constants';
import {type CurrentGomonCall, setCurrentGomonCall, setGomonMinimized, useCurrentGomonCall} from '@gomon/store';
import {bridgeCommand, formatCallDuration, nextAudioRoute, parseBridgeMessage, urlOrigin} from '@gomon/utils';
import {useDefaultHeaderHeight} from '@hooks/header';
import {getTranslations} from '@i18n';
import {useCurrentScreen} from '@store/navigation_store';
import {logWarning} from '@utils/log';
import {tryOpenURL} from '@utils/url';

import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';

// ponytail: the package's class typing is `Component<WebViewProps & undefined>` = never
// under strict null checks; re-type it until upstream fixes the default generic.
type WebViewHandle = {injectJavaScript: (script: string) => void};
const WebView = WebViewBase as unknown as React.ComponentType<WebViewProps & React.RefAttributes<WebViewHandle>>;

const messages = defineMessages({
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
    leaveTitle: {id: 'gomon.leave_title', defaultMessage: 'Leave the call?'},
    leave: {id: 'gomon.leave', defaultMessage: 'Leave'},
    cancel: {id: 'gomon.cancel', defaultMessage: 'Cancel'},
    minimize: {id: 'gomon.minimize', defaultMessage: 'Minimize'},
    hangUp: {id: 'gomon.hang_up', defaultMessage: 'End call'},
    expand: {id: 'gomon.return_to_call', defaultMessage: 'Return to call'},
});

// The page answers "leave" with comms:ended ~1.8 s later; close anyway if it does not.
const LEAVE_FALLBACK_MS = 4000;

const styles = StyleSheet.create({
    expanded: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
    minimized: {position: 'absolute', left: 8, right: 8},
    bar: {height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8},
    title: {flex: 1, color: '#fff', fontSize: 16, fontWeight: '600'},
    button: {padding: 6},
    hangUp: {padding: 6, borderRadius: 18, backgroundColor: '#d24b4e'},
    webview: {flex: 1, backgroundColor: '#000'},

    // Minimized: still mounted, attached and VISIBLE to Android (so Chromium keeps the page
    // visible and WebRTC running), only 1 px and transparent.
    webviewHidden: {position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0},
    mini: {height: 48, borderRadius: 8, backgroundColor: '#1e325c', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, elevation: 4},
    miniText: {flex: 1, marginLeft: 4},
    miniTitle: {color: '#fff', fontSize: 14, fontWeight: '600'},
    miniSub: {color: 'rgba(255,255,255,0.72)', fontSize: 12},
});

const GomonCall = ({call}: {call: CurrentGomonCall}) => {
    const {serverUrl, channelId, url, withCamera, minimized, title, startedAt} = call;
    const intl = useIntl();
    const insets = useSafeAreaInsets();
    const headerHeight = useDefaultHeaderHeight();
    const currentScreen = useCurrentScreen();
    const webViewRef = useRef<WebViewHandle>(null);
    const closed = useRef(false);
    const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [state, setState] = useState<{mic: boolean; people: number}>();
    const [audio, setAudio] = useState<AudioRoute>();
    const [now, setNow] = useState(Date.now);
    const audioRef = useRef<AudioRoute | undefined>(undefined);
    const pinnedRoute = useRef<AudioDeviceType | undefined>(undefined);
    const wantedRoute = useRef<AudioDeviceType | undefined>(undefined);
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

    const askLeave = useCallback(() => {
        Alert.alert(intl.formatMessage(messages.leaveTitle), undefined, [
            {text: intl.formatMessage(messages.cancel), style: 'cancel'},
            {text: intl.formatMessage(messages.leave), style: 'destructive', onPress: leave},
        ]);
    }, [intl, leave]);

    const toggleMic = useCallback(() => {
        webViewRef.current?.injectJavaScript(bridgeCommand('mic'));
    }, []);

    const minimize = useCallback(() => setGomonMinimized(true), []);
    const expand = useCallback(() => setGomonMinimized(false), []);

    const selectAudio = useCallback((device: AudioDeviceType) => {
        pinnedRoute.current = device;
        wantedRoute.current = device;
        CallsNative.setAudioRoute(device);
    }, []);

    // Call lifecycle = this component's, which the host keys by the store's call.
    useEffect(() => {
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
            clearTimeout(leaveTimer.current);
            sub.remove();
            routeSub.remove();
            CallsNative.stopAudioSession();
            foregroundServiceStop();
        };

    // Once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Back minimizes. Re-registered on screen changes so it stays the newest, first-called listener.
    useEffect(() => {
        if (minimized) {
            return undefined;
        }
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            minimize();
            return true;
        });
        return () => sub.remove();
    }, [minimized, minimize, currentScreen]);

    // Duration tick, only while the bar shows it.
    useEffect(() => {
        if (!minimized) {
            return undefined;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [minimized]);

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

    const people = state ? intl.formatMessage(messages.people, {count: state.people}) : '';
    const duration = formatCallDuration(now - startedAt);
    const micButton = state && (
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
    );
    const audioButton = audio && (
        <AudioOutputButton
            route={audio}
            onSelect={selectAudio}
            style={styles.button}
        />
    );

    // The WebView keeps its slot and parents in both presentations, so React never remounts
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
                        style={styles.button}
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
                    >
                        {people ? `${title} · ${people}` : title}
                    </Text>
                    {audioButton}
                    {micButton}
                    <Pressable
                        onPress={askLeave}
                        style={styles.hangUp}
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
                    {micButton}
                    {audioButton}
                    <Pressable
                        onPress={leave}
                        style={styles.hangUp}
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
            <GomonCall
                key={call.startedAt}
                call={call}
            />
        </IntlProvider>
    );
};

export default GomonCallHost;
