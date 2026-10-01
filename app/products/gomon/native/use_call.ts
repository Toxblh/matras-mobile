// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/* eslint-disable max-nested-callbacks -- the room's handlers live inside the call's effect */

import NetInfo from '@react-native-community/netinfo';
import {ConnectionQuality, ConnectionState, DisconnectReason, Room, RoomEvent, Track, type LocalVideoTrack, type Participant} from 'livekit-client';
import {useCallback, useEffect, useReducer, useRef, useState} from 'react';
import {AppState, Dimensions, PixelRatio, Platform} from 'react-native';

import {generateId} from '@utils/general';
import {logDebug, logWarning} from '@utils/log';

import {GomonApi, isLiveCall, parseJoinUrl, type ApiError, type Call, type JoinResult} from './api';
import {ChatStore} from './shared/chat';
import {emojiOf, parseServerData} from './shared/conf';
import {initial, reduce, type ConnState} from './shared/connection';
import {CallTelemetry, clean, type MuteSource} from './shared/telemetry';

/** Why the call screen closed (meeting-web's ExitReason). */
export type ExitReason = 'LEFT' | 'SESSION_ENDED' | 'REMOVED' | 'AUTH_REVOKED' | 'DISCONNECTED' | 'MEDIA_FAILED' | 'JOIN_FAILED';

export type Flying = {id: number; identity: string; emoji: string; name: string};
export type ServerNotice = {kind: 'muted'; by: string} | {kind: 'unmute_request'; by: string};

// One device id per app run, like meeting-web's per-tab id.
const DEVICE_ID = `matras-${generateId().slice(0, 8)}`;

/** A lost network is retried this long (new join + connect) before the call is given up. */
const REJOIN_FOR_MS = 90_000;

/** A drop this soon after the join is a transport that never really worked. */
const EARLY_DROP_MS = 30_000;

const FINAL_CONN_STATES = ['REMOVED', 'SESSION_ENDED', 'AUTH_REVOKED'];

let flySeq = 0;

type Rejoin = {until: number; timer?: ReturnType<typeof setTimeout>; wake?: () => void};

type Options = {
    joinUrl: string;
    mic: boolean;
    cam: boolean;
    onExit: (reason: ExitReason, message?: string) => void;

    /** WebRTC opened the mic or camera: re-apply the audio route, upgrade the foreground service. */
    onMedia: (cam: boolean) => void;
};

/**
 * One gomon call through the LiveKit SDK, as meeting-web's InCall does it: handoff → join →
 * connect, the server snapshot (roles, hands, invitations) kept fresh by the event stream, the
 * server's control messages (reactions, mutes), telemetry, and the chat store. A lost network is
 * survived first by LiveKit's own reconnect, then by a fresh join while the call is live.
 */
export function useGomonNativeCall({joinUrl, mic, cam, onExit, onMedia}: Options) {
    const [conn, dispatch] = useReducer(reduce, initial({mic, cam}));
    const [call, setCall] = useState<Call | null>(null);
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
    const [lkState, setLkState] = useState<ConnectionState>(ConnectionState.Disconnected);
    const [facing, setFacing] = useState<'user' | 'environment'>('user');
    const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
    const [flying, setFlying] = useState<Flying[]>([]);
    const [notice, setNotice] = useState<ServerNotice | null>(null);
    const [chat, setChat] = useState<ChatStore | null>(null);

    const [room] = useState(() => new Room({adaptiveStream: true, dynacast: true}));
    if (__DEV__) {
        (globalThis as {__gomonRoom?: Room}).__gomonRoom = room; // tests read the room over the JS debugger
    }
    const api = useRef<GomonApi | null>(null);
    const callId = useRef('');
    const join = useRef<JoinResult | null>(null);
    const telemetry = useRef<CallTelemetry | null>(null);
    const exited = useRef(false);
    const connRef = useRef(conn);
    connRef.current = conn;
    const rejoining = useRef<Rejoin | null>(null);
    const joinedAt = useRef(0);
    const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const chatRef = useRef<ChatStore | null>(null);
    const props = useRef({onExit, onMedia});
    props.current = {onExit, onMedia};

    const report = useCallback((kind: Parameters<CallTelemetry['push']>[0], data: Record<string, unknown>) => {
        telemetry.current?.push(kind, data, kind === 'connection_state' || kind === 'error');
    }, []);

    const exit = useCallback((reason: ExitReason, message?: string) => {
        if (exited.current) {
            return;
        }
        exited.current = true;
        props.current.onExit(reason, message);
    }, []);

    // Server verdicts: an ended call or our removed connection closes the screen.
    const applySnapshot = useCallback((c: Call) => {
        setCall(c);
        const mine = c.connections.find((x) => x.connection_id === join.current?.connection_id);
        if (mine && FINAL_CONN_STATES.includes(mine.state)) {
            exit(mine.state as ExitReason);
        } else if (!isLiveCall(c) && c.state !== 'ENDING') {
            exit('SESSION_ENDED');
        }
    }, [exit]);

    const refresh = useCallback(() => {
        // coalesce bursts of events
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
            const a = api.current;
            if (!a || exited.current) {
                return;
            }
            a.call(callId.current).then(applySnapshot).catch((e) => logDebug('gomon native: snapshot', e));
            chatRef.current?.refresh();
        }, 80);
    }, [applySnapshot]);

    const applyIntent = useCallback(async () => {
        const {intent} = connRef.current;
        await room.localParticipant.setMicrophoneEnabled(intent.mic).catch((e) => report('device_event', {device: 'mic', event: 'error', error: String(e?.name ?? 'Error')}));
        if (intent.cam) {
            await room.localParticipant.setCameraEnabled(true, {facingMode: facing}).catch((e) => report('device_event', {device: 'camera', event: 'error', error: String(e?.name ?? 'Error')}));
        }
        props.current.onMedia(intent.cam);
        rerender();

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room, report]);

    const connect = useCallback(async () => {
        const j = await api.current!.join(callId.current, DEVICE_ID);
        join.current = j;
        if (telemetry.current) {
            telemetry.current.connectionId = j.connection_id;
        }
        await room.connect(j.livekit_url, j.token);
        joinedAt.current = Date.now();
    }, [room]);

    // The network is gone for longer than LiveKit's own reconnect: join again while the call is live.
    const rejoin = useCallback(() => {
        if (rejoining.current || exited.current) {
            return;
        }
        const state: Rejoin = {until: Date.now() + REJOIN_FOR_MS};
        rejoining.current = state;
        if (connRef.current.state === 'CONNECTED') {
            dispatch({type: 'TransportLost'});
        }
        const attempt = async () => {
            state.timer = undefined;
            if (exited.current) {
                return;
            }
            try {
                const c = await api.current!.call(callId.current);
                applySnapshot(c);
                if (exited.current) {
                    return;
                }
                await connect();
                rejoining.current = null;
                dispatch({type: 'TransportRestored'});
                report('connection_state', {state: 'CONNECTED', after: 'join'});
                await applyIntent();
            } catch (e) {
                const err = e as ApiError;
                logDebug('gomon native: rejoin', err?.message);
                if (err?.code === 'invalid_transition' || err?.status === 404) {
                    exit('SESSION_ENDED');
                } else if (err?.code === 'forbidden') {
                    exit('REMOVED');
                } else if (Date.now() > state.until) {
                    report('error', {where: 'rejoin', message: String(err?.message ?? e).slice(0, 300)});
                    exit('DISCONNECTED');
                } else {
                    state.timer = setTimeout(attempt, 3000);
                }
            }
        };
        state.wake = () => {
            if (state.timer) {
                clearTimeout(state.timer);
                attempt();
            }
        };
        attempt();
    }, [applySnapshot, applyIntent, connect, exit, report]);

    // The transport dropped for good: ask the server first, so a meeting that really ended or a
    // removal is never shown as a network problem.
    const transportLost = useCallback(async (reason: string) => {
        if (exited.current) {
            return;
        }
        const c = await api.current!.call(callId.current).catch(() => null);
        if (c) {
            applySnapshot(c);
            if (exited.current) {
                return;
            }
        }
        const tm = telemetry.current;
        if (!tm?.transportUp && Date.now() - joinedAt.current < EARLY_DROP_MS) {
            report('error', {where: 'transport', reason, ms_since_join: Date.now() - joinedAt.current, ...tm?.transportInfo()});
            exit('MEDIA_FAILED');
            return;
        }
        rejoin();
    }, [applySnapshot, exit, rejoin, report]);

    useEffect(() => {
        let stopStream: (() => void) | undefined;
        let cancelled = false;

        room.
            on(RoomEvent.ConnectionStateChanged, setLkState).
            on(RoomEvent.ParticipantConnected, rerender).
            on(RoomEvent.ParticipantDisconnected, rerender).
            on(RoomEvent.TrackSubscribed, rerender).
            on(RoomEvent.TrackUnsubscribed, rerender).
            on(RoomEvent.TrackMuted, rerender).
            on(RoomEvent.TrackUnmuted, rerender).
            on(RoomEvent.LocalTrackPublished, rerender).
            on(RoomEvent.LocalTrackUnpublished, rerender).
            on(RoomEvent.ParticipantNameChanged, rerender).
            on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
                const remote = speakers.find((p) => !p.isLocal);
                if (remote) {
                    setLastSpeaker(remote.identity);
                }
                rerender();
            }).
            on(RoomEvent.ConnectionQualityChanged, (q: ConnectionQuality, p: Participant) => {
                if (p.isLocal) {
                    setQuality(q);
                } else {
                    rerender();
                }
            }).
            on(RoomEvent.Reconnecting, () => {
                dispatch({type: 'TransportLost'});
                report('connection_state', {state: 'RECONNECTING'});
            }).
            on(RoomEvent.Reconnected, () => {
                dispatch({type: 'TransportRestored'});
                report('connection_state', {state: 'CONNECTED', after: 'reconnect'});
                refresh();
            }).
            on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
                const m = parseServerData(payload, participant?.identity, topic);
                if (m?.type === 'reaction') {
                    const emoji = emojiOf(m.reaction);
                    if (!emoji) {
                        return;
                    }
                    const f: Flying = {id: ++flySeq, identity: m.connection_id, emoji, name: m.name};
                    setFlying((x) => [...x.slice(-5), f]);
                    setTimeout(() => setFlying((x) => x.filter((y) => y.id !== f.id)), 4000);
                } else if (m?.type === 'muted') {
                    setNotice({kind: 'muted', by: m.by});
                } else if (m?.type === 'unmute_request' && !room.localParticipant.isMicrophoneEnabled) {
                    setNotice({kind: 'unmute_request', by: m.by});
                }
            }).
            on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
                report('connection_state', {state: 'DISCONNECTED', reason: reason ?? null});
                if (exited.current) {
                    return;
                }
                if (reason === DisconnectReason.ROOM_DELETED) {
                    exit('SESSION_ENDED');
                } else if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
                    // Removed by a moderator or access revoked: the server snapshot says which.
                    api.current!.call(callId.current).then((c) => {
                        applySnapshot(c);
                        exit('REMOVED');
                    }).catch(() => exit('REMOVED'));
                } else if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
                    exit('DISCONNECTED');
                } else if (!rejoining.current) {
                    transportLost(reason === undefined ? 'unknown' : DisconnectReason[reason] ?? String(reason));
                }
            });

        const start = async () => {
            const target = parseJoinUrl(joinUrl);
            if (!target) {
                throw new Error(`not a gomon join url: ${joinUrl}`);
            }
            const a = new GomonApi(target.origin);
            api.current = a;
            const {call_id: id} = await a.redeem(target.code);
            callId.current = id || target.callId;
            if (cancelled) {
                return;
            }
            dispatch({type: 'JoinRequested'});

            const tm = new CallTelemetry(async (body) => {
                try {
                    await a.diagnostics(body);
                    return {ok: true, status: 202};
                } catch (e) {
                    return {ok: false, status: (e as ApiError)?.status ?? 0};
                }
            }, callId.current, '', Platform.OS === 'ios' ? 'ios' : 'android');
            telemetry.current = tm;
            const {width} = Dimensions.get('window');
            tm.push('app_context', clean({
                embed: 'none',
                companion: false,
                guest: false,
                popout: false,
                webview: false,
                mobile: true,
                touch: true,
                pip: false,
                platform: `${Platform.OS} ${Platform.Version}`.slice(0, 40),
                screen: width < 400 ? 'xs' : 's',
                dpr: Math.round(PixelRatio.get() * 100) / 100,
            }));
            tm.start(room);

            await connect();
            if (cancelled) {
                return;
            }
            dispatch({type: 'TokenIssued'});
            dispatch({type: 'ParticipantJoined'});
            report('connection_state', {state: 'CONNECTED'});

            const store = new ChatStore(callId.current, a);
            chatRef.current = store;
            setChat(store);
            stopStream = a.stream(DEVICE_ID, refresh);
            refresh();
            await applyIntent();
        };

        start().catch((error) => {
            if (cancelled) {
                return;
            }
            logWarning('gomon native call failed', error?.message);
            report('error', {where: 'connect', message: String(error?.message ?? error).slice(0, 300)});
            const err = error as ApiError;
            if (err?.code === 'invalid_transition') {
                exit('SESSION_ENDED');
            } else {
                exit('JOIN_FAILED', err?.message);
            }
        });

        // Telemetry of the platform (the web's window/document listeners).
        const netSub = NetInfo.addEventListener((s) => {
            const type = ['wifi', 'cellular', 'ethernet', 'none', 'unknown', 'bluetooth', 'wimax'].includes(s.type) ? s.type : 'other';
            report('network_change', {event: s.isConnected === false ? 'offline' : 'change', online: s.isConnected !== false, type});
            if (s.isConnected) {
                rejoining.current?.wake?.();
            }
        });
        const appSub = AppState.addEventListener('change', (st) => {
            const tm = telemetry.current;
            if (!tm || (st !== 'active' && st !== 'background')) {
                return;
            }
            tm.hidden = st === 'background';
            tm.pushCoalesced('page_event', {event: tm.hidden ? 'hidden' : 'visible'}, 'page:' + st, 5_000);
            if (tm.hidden) {
                tm.flush(true);
            } else {
                refresh(); // events may have been missed while frozen
            }
        });

        // A slow fallback poll, as the web's chat does (the stream may be down).
        const poll = setInterval(refresh, 15_000);

        return () => {
            cancelled = true;
            exited.current = true;
            clearInterval(poll);
            clearTimeout(refreshTimer.current);
            clearTimeout(rejoining.current?.timer);
            stopStream?.();
            netSub();
            appSub.remove();
            telemetry.current?.stop();
            room.removeAllListeners();
            room.disconnect();
        };

    // Once per call; the host keys this component by the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------------------------------------------------------------- actions
    const local = room.localParticipant;
    const setMic = useCallback(async (next: boolean, from: MuteSource = 'self') => {
        telemetry.current?.markSource(from);
        dispatch({type: 'SetIntent', mic: next});
        try {
            await room.localParticipant.setMicrophoneEnabled(next);
            props.current.onMedia(room.localParticipant.isCameraEnabled);
        } catch (e) {
            logWarning('gomon native: mic', e);
            report('device_event', {device: 'mic', event: 'error', error: String((e as Error)?.name ?? 'Error')});
        }
        rerender();
    }, [room, report]);

    const setCam = useCallback(async (next: boolean) => {
        telemetry.current?.markSource('self');
        dispatch({type: 'SetIntent', cam: next});
        try {
            await room.localParticipant.setCameraEnabled(next, {facingMode: facing});
            props.current.onMedia(next);
        } catch (e) {
            logWarning('gomon native: camera', e);
            report('device_event', {device: 'camera', event: 'error', error: String((e as Error)?.name ?? 'Error')});
        }
        rerender();
    }, [room, report, facing]);

    const flipCamera = useCallback(async () => {
        const next = facing === 'user' ? 'environment' : 'user';
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
        try {
            await track?.restartTrack({facingMode: next});
            setFacing(next);
            report('device_event', {device: 'camera', event: 'changed', source: 'self'});
        } catch (e) {
            logWarning('gomon native: flip camera', e);
        }
    }, [room, facing, report]);

    const leave = useCallback(async () => {
        const j = join.current;
        if (j) {
            await api.current?.leave(j.connection_id).catch((e) => logDebug('gomon native: leave', e));
        }
        exit('LEFT');
    }, [exit]);

    const endForAll = useCallback(async () => {
        try {
            await api.current?.end(callId.current);
            exit('SESSION_ENDED');
        } catch (e) {
            // already ending/ended (another moderator, or the call timed out): that is the goal
            if ((e as ApiError).code === 'invalid_transition') {
                exit('SESSION_ENDED');
            } else {
                throw e;
            }
        }
    }, [exit]);

    return {
        room,
        api: api.current,
        callId: callId.current,
        connectionId: join.current?.connection_id ?? '',
        conn: conn.state as ConnState,

        // LiveKit's own reconnects (signal or full) or our rejoin are under way
        reconnecting: conn.state === 'RECONNECTING' || lkState === ConnectionState.Reconnecting || lkState === ConnectionState.SignalReconnecting,
        connected: conn.state === 'CONNECTED' || conn.state === 'RECONNECTING',
        call,
        quality,
        facing,
        lastSpeaker,
        flying,
        notice,
        clearNotice: () => setNotice(null),
        chat,
        micOn: local.isMicrophoneEnabled,
        camOn: local.isCameraEnabled,
        setMic,
        setCam,
        flipCamera,
        leave,
        endForAll,
        refresh,
    };
}

export type NativeCall = ReturnType<typeof useGomonNativeCall>;
