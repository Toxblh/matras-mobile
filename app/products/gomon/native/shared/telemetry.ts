// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: copied from comms apps/meeting-web/src/call/telemetry.ts (comms dc0ae61); keep in sync
// until the shared comms-core package (phase 4). Differences: the platform is a parameter, the
// sender is injected (no API_BASE / fetch keepalive), and the browser listeners (window, document,
// navigator.*) are gone: the host pushes network and app-state events itself (use_call.ts does
// it from NetInfo and AppState). appContext() is the host's too. `connectionId` is public: a
// rejoin after a lost network gets a new connection.

// Client telemetry of one call (area obs, plan §16): WebRTC stats every 10 s, device and
// permission events, network changes and connection states, sent in bounded batches to
// POST /v1/diagnostics. Never blocks the call: the buffer is bounded (oldest reports are
// dropped and the number is reported next time), batches are rate-limited to the server's
// minimum interval, failures are dropped.
// Only numbers and enums are sent: no SDP, ICE credentials, candidate addresses or tokens.
import {RoomEvent, Track, version as sdkVersion, type ConnectionQuality, type LocalTrackPublication, type Participant, type Room, type TrackPublication} from 'livekit-client';

export type ReportKind = 'webrtc_stats' | 'device_event' | 'connection_state' | 'network_change' | 'error' | 'user_report' | 'page_event' | 'app_context';

/** Who switched a microphone/camera/screen: the person (button, keyboard), a moderator, the embedding app, companion mode. */
export type MuteSource = 'self' | 'remote' | 'embed' | 'companion' | 'system';
export interface Report {kind: ReportKind; at: string; mono_ms: number; data: Record<string, unknown>}
export type Platform = 'web' | 'ios' | 'android';

// The DOM's RTCStatsReport (a read-only Map), not in React Native's typings.
export type RTCStatsReport = {forEach(f: (s: any) => void): void; get(id: string): any};

export const LIMITS = {buffer: 100, batch: 50, flushMs: 10_000, statsMs: 10_000, minIntervalMs: 2_000, maxStats: 40};

/** A track whose sender/receiver stats can be read (LiveKit LocalTrack/RemoteTrack). */
export interface StatsTrack {local: boolean; source?: string; muted?: boolean; getRTCStatsReport(): Promise<RTCStatsReport | undefined>}
type Rep = {local: boolean; rep: RTCStatsReport; source?: string; muted?: boolean};

type Prev = {t: number; bytes: number; packets: number; lost: number; energy: number; dur: number};

/** RMS audio level below this for a whole sample is digital silence (−100 dBFS), not a quiet room. */
export const SILENCE = 1e-5;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const round = (v: number | undefined, d = 4) => (v === undefined ? undefined : Math.round(v * (10 ** d)) / (10 ** d));

/** Turns raw RTCStats into the allow-listed report fields; bitrate, loss and audio level are per
 * interval. `window`: bytes/packets/packetsLost are the deltas since `prev` too (a report's last 30 s). */
export function summarizeStats(reports: Rep[], prev: Map<string, Prev>, window = false) {
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const {local, rep, source, muted} of reports) {
        rep.forEach((s: any) => {
            if (seen.has(s.id)) {
                return;
            }
            seen.add(s.id);
            const src = local ? 'local' : 'remote';
            const kind = s.kind ?? s.mediaType;
            const t = num(s.timestamp) ?? performance.now();
            type D = {bitrate?: number; lossRatio?: number; audioLevel?: number; bytes?: number; packets?: number; packetsLost?: number};
            const delta = (bytes: number | undefined, packets: number | undefined, lost: number | undefined): D => {
                const p = prev.get(s.id);
                const cur = {t, bytes: bytes ?? 0, packets: packets ?? 0, lost: lost ?? 0, energy: num(s.totalAudioEnergy) ?? 0, dur: num(s.totalSamplesDuration) ?? 0};
                prev.set(s.id, cur);
                if (!p || cur.t <= p.t) {
                    return {};
                }
                const secs = (cur.t - p.t) / 1000;
                const dLost = Math.max(0, cur.lost - p.lost);
                const dPk = Math.max(0, cur.packets - p.packets);
                const dBytes = Math.max(0, cur.bytes - p.bytes);
                const dDur = cur.dur - p.dur;
                return {
                    bitrate: round((dBytes * 8) / secs, 0),
                    lossRatio: dLost + dPk > 0 ? round(dLost / (dLost + dPk)) : undefined,

                    // RMS level over the interval (totalAudioEnergy = Σ level² · duration)
                    audioLevel: kind === 'audio' && dDur > 0 ? round(Math.sqrt(Math.max(0, cur.energy - p.energy) / dDur), 6) : undefined,
                    ...(window ? {bytes: dBytes, packets: dPk, packetsLost: dLost} : {}),
                };
            };
            const track = {source, muted};
            if (s.type === 'inbound-rtp') {
                const d = delta(num(s.bytesReceived), num(s.packetsReceived), num(s.packetsLost));
                const conceal = num(s.concealedSamples) !== undefined && num(s.totalSamplesReceived) ? s.concealedSamples / s.totalSamplesReceived : undefined;
                const jbd = num(s.jitterBufferDelay) !== undefined && num(s.jitterBufferEmittedCount) ? s.jitterBufferDelay / s.jitterBufferEmittedCount : undefined;
                out.push({
                    id: s.id,
                    type: s.type,
                    kind,
                    src,
                    ...track,
                    bytes: num(s.bytesReceived),
                    packets: num(s.packetsReceived),
                    packetsLost: num(s.packetsLost),
                    jitter: num(s.jitter),
                    fps: num(s.framesPerSecond),
                    width: num(s.frameWidth),
                    height: num(s.frameHeight),
                    framesDropped: num(s.framesDropped),
                    freezeCount: num(s.freezeCount),
                    totalFreezesDuration: num(s.totalFreezesDuration),
                    nackCount: num(s.nackCount),
                    pliCount: num(s.pliCount),
                    concealedRatio: round(conceal),
                    jitterBufferDelay: round(jbd),
                    ...d,
                });
            } else if (s.type === 'outbound-rtp') {
                const d = delta(num(s.bytesSent), num(s.packetsSent), 0);
                out.push({
                    id: s.id,
                    type: s.type,
                    kind,
                    src,
                    ...track,
                    bytes: window ? d.bytes : num(s.bytesSent),
                    packets: window ? d.packets : num(s.packetsSent),
                    fps: num(s.framesPerSecond),
                    width: num(s.frameWidth),
                    height: num(s.frameHeight),
                    nackCount: num(s.nackCount),
                    pliCount: num(s.pliCount),
                    qualityLimitationReason: s.qualityLimitationReason,
                    bitrate: d.bitrate,
                });
            } else if (s.type === 'media-source' && kind === 'audio' && local) {
                // what the microphone delivers before encoding: silence here is a dead or hardware-muted mic
                const d = delta(0, 0, 0);
                out.push({id: s.id, type: s.type, kind, src, ...track, audioLevel: d.audioLevel});
            } else if (s.type === 'remote-inbound-rtp') {
                out.push({type: s.type, kind, src, rtt: num(s.roundTripTime), fractionLost: num(s.fractionLost), jitter: num(s.jitter), packetsLost: num(s.packetsLost)});
            } else if (s.type === 'candidate-pair' && (s.nominated || s.selected) && s.state === 'succeeded') {
                const lc: any = rep.get(s.localCandidateId);
                const rc: any = rep.get(s.remoteCandidateId);
                out.push({
                    type: s.type,
                    src,
                    rtt: num(s.currentRoundTripTime),
                    availableOutgoingBitrate: num(s.availableOutgoingBitrate),
                    localCandidateType: lc?.candidateType,
                    remoteCandidateType: rc?.candidateType,
                    protocol: lc?.protocol,
                    relayProtocol: lc?.relayProtocol,
                });
            }
        });
    }

    // drop undefined fields: the server schema rejects nulls where it expects numbers; the stat id
    // stays only as a non-enumerable property (never serialised) for the silence detector
    return out.slice(0, LIMITS.maxStats).map((o) => Object.defineProperty(
        Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== 'id' && v !== undefined && v !== null)), 'id', {value: o.id, enumerable: false}));
}

export type Sender = (body: unknown) => Promise<{ok: boolean; status: number}>;

export class CallTelemetry {
    private buf: Report[] = [];
    private dropped = 0;
    private rtt: number | undefined;
    private prev = new Map<string, Prev>();
    private lastFlush = 0;
    private pending: ReturnType<typeof setTimeout> | null = null;
    private timers: Array<ReturnType<typeof setInterval>> = [];
    private cleanups: Array<() => void> = [];
    private inflight = false;
    private stopped = false;
    private reconnectAt: number | null = null;
    private room: Room | null = null;
    private last = new Map<string, {at: number; n: number}>();
    private src: {s: MuteSource; at: number} | null = null;
    private remoteMutes = 0;
    private silent = new Map<string, number>(); // unmuted audio stream id → consecutive silent samples
    private history: Array<{at: number; prev: Map<string, Prev>}> = [];

    // the media transport: ICE/PC states per PeerConnection, gathered candidate types, selected pair
    private tp = {ice: {} as Record<string, string>, pc: {} as Record<string, string>, cands: new Set<string>(), pair: {} as Record<string, string>, signal: false};

    /** The app is in the background (stats samples carry it as `visibility`). */
    hidden = false;

    constructor(private send: Sender, private callId: string, public connectionId: string,
        private platform: Platform = 'web', private tracks: () => StatsTrack[] = () => []) {}

    /** Reports buffered and not yet sent (tests). */
    get buffered() {
        return this.buf.length;
    }
    get droppedCount() {
        return this.dropped;
    }

    push(kind: ReportKind, data: Record<string, unknown>, urgent = false) {
        if (this.stopped) {
            return;
        }
        let d = data;
        if (kind === 'connection_state') {
            if (d.state === 'RECONNECTING' || d.state === 'SIGNAL_RECONNECTING') {
                this.reconnectAt ??= performance.now();
            } else if (d.state === 'CONNECTED' && this.reconnectAt !== null) {
                d = {...d, duration_ms: Math.round(performance.now() - this.reconnectAt)};
                this.reconnectAt = null;
            }
        }
        if (this.buf.length >= LIMITS.buffer) {
            this.buf.shift();
            this.dropped++;
        }
        this.buf.push({kind, at: new Date().toISOString(), mono_ms: Math.round(performance.now()), data: d});
        if (urgent) {
            this.flushSoon();
        }
    }

    /** Like push, but the same `key` at most once per `ms`; the skipped ones are counted in `repeats`. */
    pushCoalesced(kind: ReportKind, data: Record<string, unknown>, key: string, ms = 5_000, urgent = false) {
        const now = performance.now();
        const l = this.last.get(key);
        if (l && now - l.at < ms) {
            l.n++;
            return;
        }
        this.last.set(key, {at: now, n: 0});
        this.push(kind, l?.n ? {...data, repeats: l.n} : data, urgent);
    }

    /** The next local mute/unmute/publish comes from this source. */
    markSource(s: MuteSource) {
        this.src = {s, at: performance.now()};
    }
    private takeSource(muted: boolean): MuteSource {
        // nothing pressed here: a mute is a moderator's (server-side) one
        let s: MuteSource = muted ? 'remote' : 'system';
        if (this.src && performance.now() - this.src.at < 5_000) {
            s = this.src.s;
        }
        this.src = null;
        return s;
    }

    /** What is known about the media transport (for a "could not connect" report). */
    transportInfo() {
        const pick = (m: Record<string, string>) => m.subscriber ?? m.publisher;
        return clean({iceState: pick(this.tp.ice) ?? 'new', pcState: pick(this.tp.pc), candidateTypes: [...this.tp.cands], signal: this.tp.signal});
    }

    /** The media transport has been connected at least once. */
    get transportUp() {
        return Object.values(this.tp.pc).includes('connected') || Boolean(Object.keys(this.tp.pair).length);
    }

    private notePair(row: Record<string, unknown>, target: string) {
        const pair = {localCandidateType: row.localCandidateType, remoteCandidateType: row.remoteCandidateType, protocol: row.protocol, relayProtocol: row.relayProtocol};
        const sig = JSON.stringify(pair);
        if (!pair.localCandidateType || this.tp.pair[target] === sig) {
            return;
        }
        this.tp.pair[target] = sig;
        this.push('connection_state', clean({event: 'pair', target, ...pair, turn: pair.localCandidateType === 'relay'}));
    }

    private async checkPair(t: {getStats(): Promise<RTCStatsReport>}, target: string) {
        const rep = await t.getStats().catch(() => undefined);
        if (!rep) {
            return;
        }
        let sel: any;
        rep.forEach((s: any) => {
            if (s.type === 'transport' && s.selectedCandidatePairId) {
                sel = rep.get(s.selectedCandidatePairId);
            }
        });
        rep.forEach((s: any) => {
            if (!sel && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
                sel = s;
            }
        });
        if (!sel) {
            return;
        }
        const lc: any = rep.get(sel.localCandidateId);
        const rc: any = rep.get(sel.remoteCandidateId);
        this.notePair({localCandidateType: lc?.candidateType, remoteCandidateType: rc?.candidateType, protocol: lc?.protocol, relayProtocol: lc?.relayProtocol}, target);
    }

    private flushSoon() {
        if (this.pending) {
            return;
        }
        const wait = Math.max(0, (this.lastFlush + LIMITS.minIntervalMs) - Date.now());
        this.pending = setTimeout(() => {
            this.pending = null;
            this.flush();
        }, wait);
    }

    private async readTracks() {
        const reps: Rep[] = [];
        for (const tr of this.tracks()) {
            // eslint-disable-next-line no-await-in-loop
            const rep = await tr.getRTCStatsReport().catch(() => undefined);
            if (rep) {
                reps.push({local: tr.local, rep, source: tr.source, muted: tr.muted});
            }
        }
        return reps;
    }

    /** How the others are connected, for a stats sample (counts only). */
    private peers() {
        const ps = this.room ? [...this.room.remoteParticipants.values()] : [];
        const q = (v: string) => ps.filter((p) => p.connectionQuality === v).length;
        return {peers: ps.length, peers_poor: q('poor'), peers_lost: q('lost')};
    }

    async collectStats() {
        const stats = summarizeStats(await this.readTracks(), this.prev);
        const now = performance.now();
        this.history.push({at: now, prev: new Map(this.prev)});
        if (this.history.length > 4) {
            this.history.shift();
        }
        for (const r of stats) {
            if (r.type === 'candidate-pair') {
                this.notePair(r, r.src === 'local' ? 'publisher' : 'subscriber');
            }

            // an unmuted microphone that delivers digital silence for two samples in a row (20 s)
            const audio = r.kind === 'audio' && r.muted === false && (r.type === 'media-source' || (r.type === 'inbound-rtp' && r.src === 'remote'));
            if (!audio || typeof r.audioLevel !== 'number') {
                continue;
            }
            const key = String((r as {id?: string}).id);
            const n = r.audioLevel < SILENCE ? (this.silent.get(key) ?? 0) + 1 : 0;
            this.silent.set(key, n);
            if (n === 2) {
                this.push('device_event', {device: 'mic', event: 'silent_mic', source: r.src === 'local' ? 'self' : 'remote'}, true);
            }
        }
        const head = {interval_ms: LIMITS.statsMs, remote_mutes: this.remoteMutes, ...this.peers(), visibility: this.hidden ? 'hidden' : 'visible'};
        this.remoteMutes = 0;
        if (stats.length) {
            this.push('webrtc_stats', {stats, ...head});
        }
    }

    /** Stats of about the last 30 s (deltas, not totals since the join) for a problem report. */
    async windowStats() {
        const reps = await this.readTracks();
        const now = performance.now();
        const base = [...this.history].reverse().find((h) => now - h.at >= 29_000) ?? this.history[0];
        const stats = summarizeStats(reps, new Map(base?.prev ?? []), Boolean(base));
        return {stats: stats.slice(0, LIMITS.maxStats), window_ms: base ? Math.round(now - base.at) : undefined, ...this.peers()};
    }

    async flush(final = false) {
        if (this.inflight || this.buf.length === 0) {
            return;
        }
        if (!final && Date.now() - this.lastFlush < LIMITS.minIntervalMs) {
            this.flushSoon();
            return;
        }
        const reports = this.buf.splice(0, LIMITS.batch);
        const body = {
            call_id: this.callId,
            connection_id: this.connectionId,
            sent_at: new Date().toISOString(),
            rtt_ms: this.rtt,
            platform: this.platform,
            sdk: {name: 'livekit-client', version: sdkVersion},
            dropped: this.dropped,
            reports,
        };
        this.inflight = true;
        this.lastFlush = Date.now();
        const t0 = performance.now();
        try {
            const r = await this.send(body);
            if (r.ok) {
                this.rtt = Math.round(performance.now() - t0);
                this.dropped = 0;
            } else {
                this.dropped += reports.length; // rate limited / rejected: counted, not retried (bounded memory)
            }
        } catch {
            this.dropped += reports.length;
        } finally {
            this.inflight = false;
        }
        if (this.buf.length) {
            this.flushSoon();
        }
    }

    /** Starts periodic stats and the room listeners for a LiveKit room. */
    start(room?: Room) {
        if (room) {
            this.tracks = () => roomTracks(room);
            this.room = room;
        }
        this.timers.push(setInterval(() => {
            this.collectStats();
        }, LIMITS.statsMs));
        this.timers.push(setInterval(() => {
            this.flush();
        }, LIMITS.flushMs));
        if (!room) {
            return;
        }
        const src = (s: Track.Source) => {
            switch (s) {
                case Track.Source.Microphone: return 'mic';
                case Track.Source.Camera: return 'camera';
                case Track.Source.ScreenShare: return 'screen';
                default: return undefined;
            }
        };
        const pub = (p: LocalTrackPublication) => {
            const d = src(p.source);
            if (d) {
                this.push('device_event', {device: d, event: 'enabled', source: this.takeSource(false)});
            }
        };
        const unpub = (p: LocalTrackPublication) => {
            const d = src(p.source);
            if (d) {
                this.push('device_event', {device: d, event: 'disabled', source: this.takeSource(true)});
            }
        };
        const mute = (muted: boolean) => (p: TrackPublication, who: Participant) => {
            if (!who.isLocal) {
                this.remoteMutes++; // others: a counter in the next stats sample
                return;
            }
            const d = src(p.source);
            if (d) {
                this.push('device_event', {device: d, event: muted ? 'muted' : 'unmuted', source: this.takeSource(muted)});
            }
        };
        const muted = mute(true);
        const unmuted = mute(false);
        const devErr = (e: Error) => this.push('device_event', {event: 'error', error: e?.name || 'Error'}, true);
        const sigRec = () => this.push('connection_state', {state: 'SIGNAL_RECONNECTING'}, true);
        const sigUp = () => {
            this.tp.signal = true;
        };
        const quality = (q: ConnectionQuality, p: Participant) => {
            if (p.isLocal) {
                this.pushCoalesced('connection_state', {event: 'quality', quality: q}, 'quality:' + q, 30_000);
            }
        };
        room.on(RoomEvent.LocalTrackPublished, pub).on(RoomEvent.LocalTrackUnpublished, unpub).
            on(RoomEvent.TrackMuted, muted).on(RoomEvent.TrackUnmuted, unmuted).
            on(RoomEvent.MediaDevicesError, devErr).on(RoomEvent.SignalReconnecting, sigRec).
            on(RoomEvent.SignalConnected, sigUp).on(RoomEvent.ConnectionQualityChanged, quality);
        this.cleanups.push(() => {
            room.off(RoomEvent.LocalTrackPublished, pub).off(RoomEvent.LocalTrackUnpublished, unpub).
                off(RoomEvent.TrackMuted, muted).off(RoomEvent.TrackUnmuted, unmuted).
                off(RoomEvent.MediaDevicesError, devErr).off(RoomEvent.SignalReconnecting, sigRec).
                off(RoomEvent.SignalConnected, sigUp).off(RoomEvent.ConnectionQualityChanged, quality);
        });
        this.watchTransports(room);
    }

    /** ICE and PeerConnection states and gathered candidate types of LiveKit's two PeerConnections
     * (engine internals: every hook is optional and wraps, never replaces, LiveKit's own callbacks). */
    private watchTransports(room: Room) {
        const engine: any = (room as any).engine;
        if (!engine?.on) {
            return;
        }
        const hook = (...ts: any[]) => {
            ts.forEach((t, i) => {
                if (!t) {
                    return;
                }
                const target = i === 0 ? 'publisher' : 'subscriber';
                const chain = (name: string, f: (v: any) => void) => {
                    const prev = t[name];
                    t[name] = (v: any) => {
                        prev?.(v);
                        try {
                            f(v);
                        } catch {
                            // telemetry never breaks the call
                        }
                    };
                };
                chain('onIceCandidate', (c: {type?: string} | null) => {
                    if (c?.type) {
                        this.tp.cands.add(c.type);
                    }
                });
                chain('onIceConnectionStateChange', (st: string) => {
                    this.tp.ice[target] = st;
                    this.pushCoalesced('connection_state', {event: 'ice', target, iceState: st}, `ice:${target}:${st}`, 10_000, st === 'failed');
                });
                chain('onConnectionStateChange', (st: string) => {
                    if (this.tp.pc[target] === st) {
                        return;
                    }
                    this.tp.pc[target] = st;
                    this.pushCoalesced('connection_state', {event: 'pc', target, pcState: st}, `pc:${target}:${st}`, 10_000, st === 'failed');
                    if (st === 'connected' && t.getStats) {
                        setTimeout(() => this.checkPair(t, target), 1_000);
                    }
                });
            });
        };
        engine.on('transportsCreated', hook);
        this.cleanups.push(() => engine.off?.('transportsCreated', hook));
    }

    /** Final stats and flush; idempotent. */
    stop() {
        if (this.stopped) {
            return;
        }
        this.timers.forEach(clearInterval);
        if (this.pending) {
            clearTimeout(this.pending);
        }
        this.cleanups.forEach((f) => f());
        this.inflight = false;
        this.flush(true);
        this.stopped = true;
    }
}

export const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));

const SOURCES: Record<string, string> = {microphone: 'mic', camera: 'camera', screen_share: 'screen', screen_share_audio: 'screen_audio'};

function roomTracks(room: Room): StatsTrack[] {
    const out: StatsTrack[] = [];
    const add = (local: boolean, pubs: Iterable<{track?: any; source?: string; isMuted?: boolean}>) => {
        for (const p of pubs) {
            if (p.track?.getRTCStatsReport) {
                out.push({local, source: SOURCES[p.source ?? ''], muted: Boolean(p.isMuted), getRTCStatsReport: () => p.track.getRTCStatsReport()});
            }
        }
    };
    add(true, room.localParticipant.trackPublications.values());
    for (const rp of room.remoteParticipants.values()) {
        add(false, rp.trackPublications.values());
    }
    return out;
}
