// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages, useIntl} from 'react-intl';
import {Alert, Pressable, StyleSheet, Text, View} from 'react-native';

import CompassIcon from '@components/compass_icon';
import {useGomonCallSession} from '@gomon/call_session';
import AudioOutputButton from '@gomon/components/audio_output_button';
import GomonCallLayout, {callStyles} from '@gomon/components/call_layout';
import {type CurrentGomonCall, setCurrentGomonCall} from '@gomon/store';
import {getFullErrorMessage} from '@utils/errors';
import {generateId} from '@utils/general';
import {logDebug, logWarning} from '@utils/log';

import {joinCall, leaveConnection, parseJoinUrl, redeemHandoff} from './api';
import {loadLiveKit} from './livekit';

import type {Participant, Room} from 'livekit-client';

const messages = defineMessages({
    people: {id: 'gomon.call_people', defaultMessage: '{count, plural, one {# participant} other {# participants}}'},
    failed: {id: 'gomon.call_failed', defaultMessage: 'Could not connect to the call'},
    connecting: {id: 'gomon.connecting', defaultMessage: 'Connecting…'},
});

// One device id per app run, like meeting-web's per-tab id.
const DEVICE_ID = `matras-${generateId().slice(0, 8)}`;

const styles = StyleSheet.create({
    grid: {flex: 1, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#000'},
    tile: {padding: 2},
    tileInner: {flex: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1b1d22', alignItems: 'center', justifyContent: 'center'},
    video: {...StyleSheet.absoluteFillObject},
    name: {position: 'absolute', left: 8, bottom: 6, color: '#fff', fontSize: 13, textShadowColor: '#000', textShadowRadius: 3},
    initial: {color: '#fff', fontSize: 40, fontWeight: '600'},
    status: {flex: 1, alignItems: 'center', justifyContent: 'center'},
    statusText: {color: 'rgba(255,255,255,0.72)', fontSize: 16},
});

const Tile = ({participant, width, height}: {participant: Participant; width: `${number}%`; height: `${number}%`}) => {
    const {rn: {VideoTrack}, client: {Track}} = loadLiveKit();
    const publication = participant.getTrackPublication(Track.Source.Camera);
    const name = participant.name || participant.identity;
    return (
        <View style={[styles.tile, {width, height}]}>
            <View style={styles.tileInner}>
                {publication?.track && !publication.isMuted ? (
                    <VideoTrack
                        trackRef={{participant, publication, source: Track.Source.Camera}}
                        style={styles.video}
                        objectFit='cover'
                        mirror={participant.isLocal}
                    />
                ) : (
                    <Text style={styles.initial}>{name.slice(0, 1).toUpperCase()}</Text>
                )}
                <Text
                    style={styles.name}
                    numberOfLines={1}
                >
                    {name}
                </Text>
            </View>
        </View>
    );
};

// ponytail: plain 1–2 column grid of every participant's camera; speaker view, screen share
// and paging come with the phase 1 call screen.
const Grid = ({room}: {room: Room}) => {
    const participants: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const cols = participants.length > 1 ? 2 : 1;
    const rows = Math.ceil(participants.length / cols);
    const width = `${100 / cols}%` as const;
    const height = `${100 / rows}%` as const;
    return (
        <View style={styles.grid}>
            {participants.map((p) => (
                <Tile
                    key={p.identity}
                    participant={p}
                    width={width}
                    height={height}
                />
            ))}
        </View>
    );
};

/** gomon call through the LiveKit SDK: the same API sequence as meeting-web, native media. */
const GomonNativeCall = ({call}: {call: CurrentGomonCall}) => {
    const {url, withCamera, minimized} = call;
    const intl = useIntl();
    const [room, setRoom] = useState<Room>();
    const [, setTick] = useState(0);
    const closed = useRef(false);

    // Unmounting (after close) disconnects and reports the leave; see the effect below.
    const close = useCallback(() => {
        if (!closed.current) {
            closed.current = true;
            setCurrentGomonCall(undefined);
        }
    }, []);

    const {audio, selectAudio, reapplyRoute, now} = useGomonCallSession(call, close);

    useEffect(() => {
        const {client: {Room: LiveKitRoom, RoomEvent}} = loadLiveKit();
        const lkRoom = new LiveKitRoom({adaptiveStream: true, dynacast: true});
        let cancelled = false;
        let session: {origin: string; token: string; connectionId: string} | undefined;

        const rerender = () => setTick((t) => t + 1);
        for (const event of [
            RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
            RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
            RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ParticipantNameChanged,
        ]) {
            lkRoom.on(event, rerender);
        }

        // Server ended the call, we were removed, or the connection is lost for good.
        lkRoom.on(RoomEvent.Disconnected, close);

        const start = async () => {
            const target = parseJoinUrl(url);
            if (!target) {
                throw new Error(`not a gomon join url: ${url}`);
            }
            const {token, call_id: callId} = await redeemHandoff(target.origin, target.code);
            const joined = await joinCall(target.origin, token, callId || target.callId, DEVICE_ID);
            session = {origin: target.origin, token, connectionId: joined.connection_id};
            if (cancelled) {
                return;
            }
            await lkRoom.connect(joined.livekit_url, joined.token);
            if (cancelled) {
                return;
            }
            setRoom(lkRoom);
            await lkRoom.localParticipant.setMicrophoneEnabled(true);
            if (withCamera) {
                await lkRoom.localParticipant.setCameraEnabled(true);
            }

            // WebRTC may reset the route when it opens the mic.
            reapplyRoute();
            rerender();
        };

        start().catch((error) => {
            if (cancelled) {
                return;
            }
            logWarning('gomon native call failed', getFullErrorMessage(error));
            Alert.alert(intl.formatMessage(messages.failed), getFullErrorMessage(error));
            close();
        });

        return () => {
            cancelled = true;
            lkRoom.removeAllListeners();
            lkRoom.disconnect();
            if (session) {
                leaveConnection(session.origin, session.token, session.connectionId).catch((e) => logDebug('gomon native: leave', e));
            }
        };

    // Once per call; the host keys this component by the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const local = room?.localParticipant;
    const micOn = Boolean(local?.isMicrophoneEnabled);
    const camOn = Boolean(local?.isCameraEnabled);

    const toggleMic = useCallback(async () => {
        try {
            await local?.setMicrophoneEnabled(!micOn);
        } catch (e) {
            logWarning('gomon native: mic', e);
        }
        setTick((t) => t + 1);
    }, [local, micOn]);

    const toggleCam = useCallback(async () => {
        try {
            await local?.setCameraEnabled(!camOn);
        } catch (e) {
            logWarning('gomon native: camera', e);
        }
        setTick((t) => t + 1);
    }, [local, camOn]);

    const buttons = (
        <>
            {local && !minimized &&
                <Pressable
                    onPress={toggleCam}
                    style={callStyles.button}
                    testID='gomon_call.camera'
                >
                    <CompassIcon
                        name={camOn ? 'video-outline' : 'video-off-outline'}
                        size={24}
                        color='#fff'
                    />
                </Pressable>
            }
            {local &&
                <Pressable
                    onPress={toggleMic}
                    style={callStyles.button}
                    testID='gomon_call.mic'
                >
                    <CompassIcon
                        name={micOn ? 'microphone' : 'microphone-off'}
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

    let body = null;
    if (!minimized) {
        body = room ? <Grid room={room}/> : (
            <View style={styles.status}>
                <Text style={styles.statusText}>{intl.formatMessage(messages.connecting)}</Text>
            </View>
        );
    }

    return (
        <GomonCallLayout
            call={call}
            people={room ? intl.formatMessage(messages.people, {count: room.remoteParticipants.size + 1}) : ''}
            now={now}
            buttons={buttons}
            onLeave={close}
        >
            {body}
        </GomonCallLayout>
    );
};

export default GomonNativeCall;
