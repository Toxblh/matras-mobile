// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {ScreenCapturePickerView} from '@livekit/react-native-webrtc';
import RNUtils from '@mattermost/rnutils';
import Clipboard from '@react-native-clipboard/clipboard';
import {ConnectionQuality} from 'livekit-client';
import React, {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, AppState, NativeModules, Platform, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle, type AlertButton} from 'react-native';

import CompassIcon, {type CompassIconName} from '@components/compass_icon';
import {SNACK_BAR_TYPE} from '@constants/snack_bar';
import {useGomonCallSession} from '@gomon/call_session';
import AudioOutputButton from '@gomon/components/audio_output_button';
import GomonCallLayout, {callStyles} from '@gomon/components/call_layout';
import {hasCameraPermission} from '@gomon/permissions';
import {type CurrentGomonCall, setCurrentGomonCall, setGomonCallSession, setGomonMinimized} from '@gomon/store';
import {hapticFeedback} from '@utils/general';
import {logWarning} from '@utils/log';
import {showSnackBar} from '@utils/snack_bar';

import {pickPipTile} from './android_pip';
import {androidMessages, useAndroidCallPlatform} from './android_platform';
import {confOf, REACTIONS} from './call_core';
import {useCallKitSession} from './callkit_session';
import {messages} from './messages';
import {AccessSheet, KnockBanner, lobbyOf} from './moderation';
import {hasSip, PhoneSheet} from './phone';
import {RecIndicator, RecordItem, RecordSheet} from './recording';
import ReportSheet from './report';
import {ChatSheet, InviteSheet, PeopleSheet, Sheet, SheetItem, sheetStyles} from './sheets';
import Stage, {QualityBars, buildTiles, type Layout} from './stage';
import {useGomonNativeCall, type ExitReason} from './use_call';

import type {ApiError} from './api';

const shared = defineMessages({
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
    failed: {id: 'gomon.call_failed', defaultMessage: 'Could not connect to the call'},
    connecting: {id: 'gomon.connecting', defaultMessage: 'Connecting…'},
    leaveTitle: {id: 'gomon.leave_title', defaultMessage: 'Leave the call?'},
    leave: {id: 'gomon.leave', defaultMessage: 'Leave'},
    cancel: {id: 'gomon.cancel', defaultMessage: 'Cancel'},
});

const LAYOUTS: Layout[] = ['auto', 'grid', 'speaker'];
const LAYOUT_MSG = {auto: messages.layoutAuto, grid: messages.layoutGrid, speaker: messages.layoutSpeaker};
const ENDED_MSG: Partial<Record<ExitReason, typeof messages.endedSESSIONENDED>> = {
    SESSION_ENDED: messages.endedSESSIONENDED,
    REMOVED: messages.endedREMOVED,
    AUTH_REVOKED: messages.endedAUTHREVOKED,
    DISCONNECTED: messages.endedDISCONNECTED,
    MEDIA_FAILED: messages.endedMEDIAFAILED,
};

const styles = StyleSheet.create({
    body: {flex: 1},
    banner: {marginHorizontal: 8, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#7a5a00'},
    bannerText: {color: '#fff', fontSize: 13},
    status: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    statusText: {color: 'rgba(255,255,255,0.72)', fontSize: 16},
    waiting: {position: 'absolute', top: 8, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)'},
    controls: {flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', paddingVertical: 10},
    ctl: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)'},
    ctlOff: {backgroundColor: '#d24b4e'},
    ctlOn: {backgroundColor: '#c58c1c'},
    badge: {position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: '#d24b4e', alignItems: 'center', justifyContent: 'center'},
    badgeText: {color: '#fff', fontSize: 10, fontWeight: '700'},
    emojiRow: {flexDirection: 'row', justifyContent: 'space-evenly', paddingVertical: 16},
    emoji: {fontSize: 34},
    feed: {position: 'absolute', left: 8, bottom: 76, gap: 4},
    feedItem: {flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)'},
    feedEmoji: {fontSize: 18},
    feedName: {color: '#fff', fontSize: 12},
    pip: {...StyleSheet.absoluteFillObject, backgroundColor: '#000'},
    share: {flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginBottom: 6, paddingLeft: 12, borderRadius: 8, backgroundColor: '#1c58d9'},
    shareText: {flex: 1, color: '#fff', fontSize: 13},
    shareStop: {paddingHorizontal: 12, paddingVertical: 8},
    shareStopText: {color: '#fff', fontSize: 13, fontWeight: '700'},
    companion: {flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginBottom: 6, paddingLeft: 12, borderRadius: 8, backgroundColor: '#2a3550'},
    failed: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 14},
    failedTitle: {color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center'},
    failedHint: {color: 'rgba(255,255,255,0.72)', fontSize: 14, textAlign: 'center'},
    failedActs: {flexDirection: 'row', gap: 12, marginTop: 6},
});

const toast = (customMessage: string) => showSnackBar({barType: SNACK_BAR_TYPE.PLUGIN_TOAST, customMessage});

type CtlProps = {icon: CompassIconName; label: string; onPress: () => void; on?: boolean; off?: boolean; badge?: string; testID: string};
const Ctl = ({icon, label, onPress, on, off, badge, testID}: CtlProps) => (
    <Pressable
        onPress={onPress}
        style={[styles.ctl, off && styles.ctlOff, on && styles.ctlOn]}
        accessibilityRole='button'
        accessibilityLabel={badge ? `${label}, ${badge}` : label}
        testID={testID}
    >
        <CompassIcon
            name={icon}
            size={24}
            color='#fff'
        />
        {Boolean(badge) &&
            <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
            </View>
        }
    </Pressable>
);

type Sheets = 'people' | 'chat' | 'invite' | 'more' | 'access' | 'record' | 'phone' | 'report' | null;

/** gomon call through the LiveKit SDK: meeting-web's call screen, natively. */
const NativeCallScreen = ({call, onMediaFailed}: {call: CurrentGomonCall; onMediaFailed: () => void}) => {
    const {minimized} = call;
    const intl = useIntl();
    const [layout, setLayout] = useState<Layout>('auto');
    const [sheet, setSheet] = useState<Sheets>(null);
    const [, tick] = useReducer((n: number) => n + 1, 0);
    const closed = useRef(false);

    const close = useCallback((reason: ExitReason, message?: string) => {
        if (closed.current) {
            return;
        }
        closed.current = true;

        // the network blocks the call's media: the web's MEDIA_FAILED screen with "Try again"
        if (reason === 'MEDIA_FAILED') {
            onMediaFailed();
            return;
        }
        setCurrentGomonCall(undefined);
        const ended = ENDED_MSG[reason];
        if (reason === 'JOIN_FAILED') {
            Alert.alert(intl.formatMessage(shared.failed), message);
        } else if (ended && reason === 'DISCONNECTED') {
            Alert.alert(intl.formatMessage(shared.failed), intl.formatMessage(ended));
        } else if (ended) {
            toast(intl.formatMessage(ended));
        }
    }, [intl, onMediaFailed]);

    // The platform session below needs the call's leave; the call needs the session's route.
    const media = useRef({reapplyRoute: () => undefined as void, mediaStarted: ((() => undefined) as (cam: boolean, mic: boolean) => void)});
    const nc = useGomonNativeCall({
        joinUrl: call.url,
        mic: call.withMic,
        cam: call.withCamera,
        session: call.session,
        onSession: (s) => setGomonCallSession(call.url, s),
        onExit: close,
        onMedia: (cam, mic) => {
            // WebRTC may reset the route when it opens the mic.
            media.current.reapplyRoute();
            media.current.mediaStarted(cam, mic);
        },
    });
    useCallKitSession(call, {connected: nc.connected, micOn: nc.micOn, setMic: nc.setMic});
    const {room, call: snapshot} = nc;
    const conf = confOf(snapshot);
    const others = room.remoteParticipants.size;
    const moderator = snapshot?.my_role === 'host' || snapshot?.my_role === 'cohost';

    // Hang up without asking (notification action, minimized bar): the web's rule, a moderator
    // alone ends the call for everyone so it does not linger.
    const hangUp = useCallback(() => {
        if (moderator && others === 0) {
            nc.endForAll().catch(() => nc.leave());
        } else {
            nc.leave();
        }
    }, [moderator, others, nc]);

    const {audio, selectAudio, reapplyRoute, mediaStarted, now} = useGomonCallSession(call, hangUp);
    media.current = {reapplyRoute, mediaStarted};

    // Our own screen is not shown back to us: a banner says it is being shared.
    const tiles = buildTiles([room.localParticipant, ...room.remoteParticipants.values()]).filter((t) => !(t.local && t.screen));
    const pipTile = pickPipTile(tiles, nc.lastSpeaker);
    const android = useAndroidCallPlatform(nc, minimized, pipTile);

    // iOS in the background: only the Picture in Picture tile keeps decoding (Android: see android_pip)
    const [appState, setAppState] = useState<string>(AppState.currentState);
    useEffect(() => {
        if (Platform.OS !== 'ios') {
            return undefined;
        }
        const sub = AppState.addEventListener('change', setAppState);
        return () => sub.remove();
    }, []);
    const pipOnly = Platform.OS === 'ios' && appState === 'background';

    const askLeave = useCallback(() => {
        if (moderator && others === 0) {
            hangUp();
            return;
        }
        const buttons: AlertButton[] = [
            {text: intl.formatMessage(shared.cancel), style: 'cancel'},
            {text: intl.formatMessage(shared.leave), onPress: () => nc.leave()},
        ];
        if (moderator) {
            buttons.push({
                text: intl.formatMessage(messages.endForAll),
                style: 'destructive',
                onPress: () => nc.endForAll().catch((e: ApiError) => toast(e.message)),
            });
        }
        Alert.alert(intl.formatMessage(shared.leaveTitle), undefined, buttons);
    }, [moderator, others, hangUp, intl, nc]);

    // The sheets belong to the full-screen call.
    useEffect(() => {
        if (minimized) {
            setSheet(null);
        }
    }, [minimized]);

    // The app is portrait-only on phones; the full-screen call turns with the device, like the gallery.
    useEffect(() => {
        if (minimized) {
            RNUtils.lockPortrait();
        } else {
            RNUtils.unlockOrientation();
        }
    }, [minimized]);
    useEffect(() => () => RNUtils.lockPortrait(), []);

    // Unread chat badge.
    useEffect(() => nc.chat?.subscribe(tick), [nc.chat]);

    // Server control messages that need the person.
    const {notice, clearNotice, setMic} = nc;
    useEffect(() => {
        if (!notice) {
            return;
        }
        clearNotice();
        if (notice.kind === 'muted') {
            toast(intl.formatMessage(messages.mutedYou, {name: notice.by}));
        } else {
            Alert.alert(intl.formatMessage(messages.unmuteAsk, {name: notice.by}), undefined, [
                {text: intl.formatMessage(messages.notNow), style: 'cancel'},
                {text: intl.formatMessage(messages.unmuteYes), onPress: () => setMic(true, 'remote')},
            ]);
        }
    }, [notice, clearNotice, setMic, intl]);

    const toggleMic = useCallback(() => {
        hapticFeedback();
        nc.setMic(!nc.micOn);
    }, [nc]);

    const toggleCam = useCallback(async () => {
        if (!nc.camOn && !(await hasCameraPermission(intl))) {
            return;
        }
        hapticFeedback();
        nc.setCam(!nc.camOn);
    }, [intl, nc]);

    const toggleHand = useCallback(async () => {
        try {
            await nc.api?.hand(nc.callId, !conf.my_hand.raised);
            hapticFeedback();
            nc.refresh();
        } catch (e) {
            toast((e as ApiError)?.message || intl.formatMessage(messages.error));
        }
    }, [nc, conf.my_hand.raised, intl]);

    const react = useCallback(async (key: string) => {
        setSheet(null);
        hapticFeedback();
        try {
            await nc.api?.react(nc.callId, key, nc.connectionId);
        } catch (e) {
            logWarning('gomon native: reaction', e);
            toast(intl.formatMessage(messages.reactFailed));
        }
    }, [nc, intl]);

    const copyLink = useCallback(() => {
        setSheet(null);
        if (snapshot?.meet_url) {
            Clipboard.setString(snapshot.meet_url);
            toast(intl.formatMessage(messages.linkCopied));
        }
    }, [snapshot?.meet_url, intl]);

    // iOS: the system broadcast picker starts the Broadcast Upload Extension (ScreenShare
    // target), whose frames reach LiveKit through the app group socket.
    const picker = useRef(null);
    const sharing = room.localParticipant.isScreenShareEnabled;
    const toggleScreenShare = useCallback(async () => {
        setSheet(null);
        try {
            if (!sharing) {
                await NativeModules.ScreenCapturePickerViewManager.show(findNodeHandle(picker.current));
            }
            await room.localParticipant.setScreenShareEnabled(!sharing);
        } catch (e) {
            logWarning('gomon native: screen share', e);
        }
        tick();
    }, [room, sharing]);

    const lobbyCount = moderator ? lobbyOf(snapshot).length : 0;
    let chatBadge = '';
    if (nc.chat?.mentioned) {
        chatBadge = '@';
    } else if (nc.chat?.unread) {
        chatBadge = nc.chat.unread > 99 ? '99+' : String(nc.chat.unread);
    }

    const audioButton = audio && (
        <AudioOutputButton
            route={audio}
            onSelect={selectAudio}
            style={callStyles.button}
        />
    );
    const buttons = minimized ? (
        <>
            {nc.connected &&
                <Pressable
                    onPress={toggleMic}
                    style={callStyles.button}
                    accessibilityRole='button'
                    accessibilityLabel={intl.formatMessage(nc.micOn ? messages.mute : messages.unmute)}
                    testID='gomon_call.mic'
                >
                    <CompassIcon
                        name={nc.micOn ? 'microphone' : 'microphone-off'}
                        size={24}
                        color='#fff'
                    />
                </Pressable>
            }
            {audioButton}
        </>
    ) : (
        <>
            {nc.connected && <QualityBars quality={nc.quality}/>}
            {audioButton}
        </>
    );

    let body = null;
    if (!minimized && !nc.connected) {
        body = (
            <View style={styles.status}>
                <Text style={styles.statusText}>{intl.formatMessage(shared.connecting)}</Text>
            </View>
        );
    } else if (!minimized) {
        let banner: string | undefined;
        if (nc.reconnecting) {
            banner = intl.formatMessage(messages.reconnecting);
        } else if (nc.quality === ConnectionQuality.Poor) {
            banner = intl.formatMessage(messages.poorNetwork);
        }
        body = (
            <View style={styles.body}>
                {banner &&
                    <View
                        style={styles.banner}
                        testID='gomon_call.banner'
                    >
                        <Text style={styles.bannerText}>{banner}</Text>
                    </View>
                }
                <RecIndicator
                    api={nc.api}
                    call={snapshot}
                    toast={toast}
                />
                {moderator &&
                    <KnockBanner
                        api={nc.api}
                        call={snapshot}
                        toast={toast}
                        refresh={nc.refresh}
                    />
                }
                {nc.companion &&
                    <View
                        style={styles.companion}
                        testID='gomon_call.companion'
                    >
                        <Text style={styles.shareText}>{intl.formatMessage(messages.companionHint)}</Text>
                        <Pressable
                            onPress={() => nc.setCompanion(false)}
                            style={styles.shareStop}
                            accessibilityRole='button'
                            testID='gomon_call.companion.off'
                        >
                            <Text style={styles.shareStopText}>{intl.formatMessage(messages.companionOff)}</Text>
                        </Pressable>
                    </View>
                }
                {android.sharing &&
                    <View
                        style={styles.share}
                        testID='gomon_call.sharing'
                    >
                        <Text style={styles.shareText}>{intl.formatMessage(androidMessages.sharing)}</Text>
                        <Pressable
                            onPress={android.toggleShare}
                            style={styles.shareStop}
                            testID='gomon_call.sharing.stop'
                        >
                            <Text style={styles.shareStopText}>{intl.formatMessage(androidMessages.stopShare)}</Text>
                        </Pressable>
                    </View>
                }
                <View style={styles.body}>
                    {android.view === 'full' &&
                        <Stage
                            tiles={tiles}
                            conf={conf}
                            layout={layout}
                            lastSpeaker={nc.lastSpeaker}
                            mirror={nc.facing === 'user'}
                            flying={nc.flying}
                            pipOnly={pipOnly}
                        />
                    }
                    {others === 0 && nc.conn === 'CONNECTED' &&
                        <View
                            style={styles.waiting}
                            testID='gomon_call.waiting'
                        >
                            <Text style={styles.bannerText}>{intl.formatMessage(messages.waitingOthers)}</Text>
                        </View>
                    }
                </View>
                <View
                    style={styles.controls}
                    accessibilityRole='toolbar'
                >
                    {!nc.companion &&
                        <Ctl
                            icon={nc.micOn ? 'microphone' : 'microphone-off'}
                            label={intl.formatMessage(nc.micOn ? messages.mute : messages.unmute)}
                            onPress={toggleMic}
                            off={!nc.micOn}
                            testID='gomon_call.controls.mic'
                        />
                    }
                    {!nc.companion &&
                        <Ctl
                            icon={nc.camOn ? 'video-outline' : 'video-off-outline'}
                            label={intl.formatMessage(nc.camOn ? messages.cameraOff : messages.cameraOn)}
                            onPress={toggleCam}
                            off={!nc.camOn}
                            testID='gomon_call.controls.camera'
                        />
                    }
                    {nc.camOn &&
                        <Ctl
                            icon='sync'
                            label={intl.formatMessage(messages.flipCamera)}
                            onPress={nc.flipCamera}
                            testID='gomon_call.controls.flip'
                        />
                    }
                    {(conf.can.raise_hand || conf.my_hand.raised) &&
                        <Ctl
                            icon='hand-right-outline'
                            label={intl.formatMessage(conf.my_hand.raised ? messages.lowerHand : messages.raiseHand)}
                            onPress={toggleHand}
                            on={conf.my_hand.raised}
                            badge={conf.my_hand.raised && conf.my_hand.position ? String(conf.my_hand.position) : undefined}
                            testID='gomon_call.controls.hand'
                        />
                    }
                    <Ctl
                        icon='message-text-outline'
                        label={intl.formatMessage(messages.chat)}
                        onPress={() => setSheet('chat')}
                        badge={chatBadge}
                        testID='gomon_call.controls.chat'
                    />
                    <Ctl
                        icon='dots-horizontal'
                        label={intl.formatMessage(messages.more)}
                        onPress={() => setSheet('more')}
                        badge={lobbyCount ? String(lobbyCount) : undefined}
                        testID='gomon_call.controls.more'
                    />
                </View>
                {nc.flying.length > 0 &&
                    <View
                        style={styles.feed}
                        pointerEvents='none'
                        testID='gomon_call.reaction_feed'
                    >
                        {nc.flying.map((f) => (
                            <View
                                key={f.id}
                                style={styles.feedItem}
                            >
                                <Text style={styles.feedEmoji}>{f.emoji}</Text>
                                <Text style={styles.feedName}>{f.name}</Text>
                            </View>
                        ))}
                    </View>
                }
            </View>
        );
    }

    // Android PiP: only the main video, no controls (the window has mic / hang-up actions).
    if (android.view === 'pip') {
        return (
            <View
                style={styles.pip}
                testID='gomon_call.pip'
            >
                {pipTile &&
                    <Stage
                        tiles={[pipTile]}
                        conf={conf}
                        layout='grid'
                        lastSpeaker={null}
                        mirror={nc.facing === 'user'}
                        flying={[]}
                    />
                }
            </View>
        );
    }

    const people = snapshot ? snapshot.connections.filter((c) => c.state === 'CONNECTED').length : others + 1;
    const openSheet = (name: Sheets) => () => setSheet(name);
    return (
        <GomonCallLayout
            call={call}
            people={nc.connected ? intl.formatMessage(shared.people, {count: people}) : ''}
            now={now}
            buttons={buttons}
            onLeave={askLeave}
            confirmLeave={false}
        >
            {body}
            {Platform.OS === 'ios' && <ScreenCapturePickerView ref={picker}/>}
            <Sheet
                visible={sheet === 'more'}
                onClose={() => setSheet(null)}
                testID='gomon_call.more'
            >
                <ScrollView>
                    {conf.can.react &&
                    <View style={styles.emojiRow}>
                        {REACTIONS.map((r) => (
                            <Pressable
                                key={r.key}
                                onPress={() => react(r.key)}
                                testID={`gomon_call.react.${r.key}`}
                            >
                                <Text style={styles.emoji}>{r.emoji}</Text>
                            </Pressable>
                        ))}
                    </View>
                    }
                    <SheetItem
                        icon='account-multiple-outline'
                        text={`${intl.formatMessage(messages.participants)} · ${people}`}
                        onPress={openSheet('people')}
                        badge={lobbyCount ? String(lobbyCount) : undefined}
                        testID='gomon_call.more.people'
                    />
                    <SheetItem
                        icon='account-plus-outline'
                        text={intl.formatMessage(messages.invite)}
                        onPress={() => setSheet('invite')}
                        testID='gomon_call.more.invite'
                    />
                    {Boolean(snapshot?.meet_url) &&
                    <SheetItem
                        icon='link-variant'
                        text={intl.formatMessage(messages.copyLink)}
                        onPress={copyLink}
                        testID='gomon_call.more.copy_link'
                    />
                    }
                    {moderator &&
                    <SheetItem
                        icon='link-variant'
                        text={intl.formatMessage(messages.access)}
                        sub={snapshot?.locked ? intl.formatMessage(messages.locked) : undefined}
                        onPress={openSheet('access')}
                        testID='gomon_call.more.access'
                    />
                    }
                    {moderator &&
                    <RecordItem
                        call={snapshot}
                        onPress={openSheet('record')}
                    />
                    }
                    {hasSip(snapshot) &&
                    <SheetItem
                        icon='phone-outline'
                        text={intl.formatMessage(messages.phone)}
                        onPress={openSheet('phone')}
                        testID='gomon_call.more.phone'
                    />
                    }
                    {android.canShare && !nc.companion &&
                    <SheetItem
                        icon='monitor-share'
                        text={intl.formatMessage(android.sharing ? androidMessages.stopShare : androidMessages.shareScreen)}
                        onPress={() => {
                            setSheet(null);
                            android.toggleShare();
                        }}
                        testID='gomon_call.more.share_screen'
                    />
                    }
                    {Platform.OS === 'ios' &&
                    <SheetItem
                        icon='monitor-share'
                        text={intl.formatMessage(sharing ? messages.screenShareStop : messages.screenShare)}
                        onPress={toggleScreenShare}
                        testID='gomon_call.more.screen_share'
                    />
                    }
                    <SheetItem
                        icon='view-grid-plus-outline'
                        text={intl.formatMessage(LAYOUT_MSG[layout])}
                        onPress={() => setLayout(LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length])}
                        testID='gomon_call.more.layout'
                    />
                    <SheetItem
                        icon='monitor-account'
                        text={intl.formatMessage(nc.companion ? messages.companionOff : messages.companionOn)}
                        sub={nc.companion ? undefined : intl.formatMessage(messages.companionSub)}
                        onPress={() => {
                            setSheet(null);
                            hapticFeedback();
                            nc.setCompanion(!nc.companion);
                        }}
                        testID='gomon_call.more.companion'
                    />
                    <SheetItem
                        icon='alert-circle-outline'
                        text={intl.formatMessage(messages.report)}
                        onPress={openSheet('report')}
                        testID='gomon_call.more.report'
                    />
                </ScrollView>
            </Sheet>
            <PeopleSheet
                visible={sheet === 'people'}
                onClose={() => setSheet(null)}
                call={snapshot}
                room={room}
                connectionId={nc.connectionId}
                api={nc.api}
                toast={toast}
                refresh={nc.refresh}
            />
            <ChatSheet
                visible={sheet === 'chat'}
                onClose={() => setSheet(null)}
                store={nc.chat}
                api={nc.api}
            />
            <AccessSheet
                visible={sheet === 'access'}
                onClose={() => setSheet(null)}
                api={nc.api}
                call={snapshot}
                moderator={moderator}
                toast={toast}
                refresh={nc.refresh}
            />
            <RecordSheet
                visible={sheet === 'record'}
                onClose={() => setSheet(null)}
                api={nc.api}
                call={snapshot}
                refresh={nc.refresh}
            />
            <PhoneSheet
                visible={sheet === 'phone'}
                onClose={() => setSheet(null)}
                api={nc.api}
                call={snapshot}
                room={room}
                connectionId={nc.connectionId}
                toast={toast}
                refresh={nc.refresh}
            />
            <ReportSheet
                visible={sheet === 'report'}
                onClose={() => setSheet(null)}
                send={nc.sendReport}
                comment={nc.sendReportComment}
                toast={toast}
            />
            <InviteSheet
                visible={sheet === 'invite'}
                onClose={() => setSheet(null)}
                api={nc.api}
                call={snapshot}
                toast={toast}
            />
        </GomonCallLayout>
    );
};

/**
 * The network let the call's signalling through but not its media (web: MEDIA_FAILED): the
 * meeting goes on, the person may retry (a new join with the same session) or switch networks.
 */
const MediaFailed = ({call, onRetry}: {call: CurrentGomonCall; onRetry: () => void}) => {
    const intl = useIntl();
    useEffect(() => setGomonMinimized(false), []);
    const close = () => setCurrentGomonCall(undefined);
    return (
        <GomonCallLayout
            call={call}
            people=''
            now={Date.now()}
            buttons={null}
            onLeave={close}
            confirmLeave={false}
        >
            <View
                style={styles.failed}
                testID='gomon_call.media_failed'
            >
                <CompassIcon
                    name='alert-outline'
                    size={44}
                    color='#ff6b6b'
                />
                <Text
                    style={styles.failedTitle}
                    accessibilityRole='header'
                >
                    {intl.formatMessage(messages.endedMEDIAFAILED)}
                </Text>
                <Text style={styles.failedHint}>{intl.formatMessage(messages.mediaFailedHint)}</Text>
                <View style={styles.failedActs}>
                    <Pressable
                        style={[sheetStyles.big, sheetStyles.btnOff]}
                        onPress={close}
                        accessibilityRole='button'
                        testID='gomon_call.media_failed.close'
                    >
                        <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.close)}</Text>
                    </Pressable>
                    <Pressable
                        style={[sheetStyles.big, sheetStyles.btn]}
                        onPress={() => {
                            hapticFeedback();
                            onRetry();
                        }}
                        accessibilityRole='button'
                        testID='gomon_call.media_failed.retry'
                    >
                        <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.retry)}</Text>
                    </Pressable>
                </View>
            </View>
        </GomonCallLayout>
    );
};

/** The native call, or its network-failure screen; "Try again" mounts a fresh call. */
const GomonNativeCall = ({call}: {call: CurrentGomonCall}) => {
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const onMediaFailed = useCallback(() => setFailed(true), []);
    if (failed) {
        return (
            <MediaFailed
                call={call}
                onRetry={() => {
                    setFailed(false);
                    setAttempt((n) => n + 1);
                }}
            />
        );
    }
    return (
        <NativeCallScreen
            key={attempt}
            call={call}
            onMediaFailed={onMediaFailed}
        />
    );
};

export default GomonNativeCall;
