// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: copied from comms apps/meeting-web/src/call/telemetry.test.ts (comms dc0ae61), adapted
// to the injected sender (see telemetry.ts).

import {CallTelemetry, LIMITS, summarizeStats, type RTCStatsReport, type StatsTrack} from './telemetry';

const report = (entries: Array<Record<string, any>>) => {
    const m = new Map(entries.map((e) => [e.id, e]));
    return m as unknown as RTCStatsReport;
};

describe('client telemetry', () => {
    it('keeps the buffer bounded and reports what it dropped', async () => {
        const sent: any[] = [];
        const t = new CallTelemetry(async (body) => {
            sent.push(body);
            return {ok: true, status: 202};
        }, 'call_1', 'conn_1');
        for (let i = 0; i < LIMITS.buffer + 25; i++) {
            t.push('device_event', {device: 'mic', event: 'enabled'});
        }
        expect(t.buffered).toBe(LIMITS.buffer);
        expect(t.droppedCount).toBe(25);
        await t.flush(true);
        expect(sent[0].reports.length).toBe(LIMITS.batch);
        expect(sent[0].dropped).toBe(25);
        expect(sent[0].sdk.name).toBe('livekit-client');
        expect(typeof sent[0].sent_at).toBe('string');
        expect(t.droppedCount).toBe(0);
    });

    it('a failing server costs reports, never memory or the call', async () => {
        const t = new CallTelemetry(async () => {
            throw new Error('offline');
        }, 'c', 'k');
        for (let i = 0; i < 10; i++) {
            t.push('error', {where: 'x'});
        }
        await t.flush(true);
        expect(t.buffered).toBe(0);
        expect(t.droppedCount).toBe(10);
    });

    it('computes per-interval bitrate and loss and sends only allow-listed fields', () => {
        const prev = new Map();
        const at = (ts: number, bytes: number, packets: number, lost: number) => report([
            {id: 'in1', type: 'inbound-rtp', kind: 'audio', timestamp: ts, bytesReceived: bytes, packetsReceived: packets, packetsLost: lost, jitter: 0.004},
            {id: 'cp', type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 0.02, localCandidateId: 'l', remoteCandidateId: 'r'},
            {id: 'l', type: 'local-candidate', candidateType: 'host', protocol: 'udp', address: '192.168.1.5', usernameFragment: 'abcd'},
            {id: 'r', type: 'remote-candidate', candidateType: 'host', address: '10.0.0.1'},
        ]);
        summarizeStats([{local: false, rep: at(1000, 0, 0, 0)}], prev);
        const s = summarizeStats([{local: false, rep: at(11000, 100_000, 990, 10)}], prev);
        const inbound: any = s.find((x) => x.type === 'inbound-rtp');
        expect(inbound.bitrate).toBe(80_000);
        expect(inbound.lossRatio).toBeCloseTo(0.01);
        const cp: any = s.find((x) => x.type === 'candidate-pair');
        expect(cp).toMatchObject({rtt: 0.02, localCandidateType: 'host', protocol: 'udp'});
        const json = JSON.stringify(s);
        expect(json).not.toContain('192.168');
        expect(json).not.toContain('usernameFragment');
    });

    it('measures how long a reconnect took', () => {
        jest.useFakeTimers();
        const t = new CallTelemetry(async () => ({ok: true, status: 202}), 'c', 'k');
        const now = jest.spyOn(performance, 'now');
        now.mockReturnValue(1000);
        t.push('connection_state', {state: 'RECONNECTING'});
        now.mockReturnValue(3500);
        t.push('connection_state', {state: 'CONNECTED', after: 'reconnect'});
        const last: any = (t as any).buf.at(-1);
        expect(last.data.duration_ms).toBe(2500);
        now.mockRestore();
        jest.useRealTimers();
    });

    it('coalesces a repeated event and counts what it skipped', () => {
        const t = new CallTelemetry(async () => ({ok: true, status: 202}), 'c', 'k');
        const now = jest.spyOn(performance, 'now');
        now.mockReturnValue(1000);
        for (let i = 0; i < 20; i++) {
            t.pushCoalesced('page_event', {event: 'blur'}, 'blur', 5000);
        }
        expect(t.buffered).toBe(1);
        now.mockReturnValue(7000);
        t.pushCoalesced('page_event', {event: 'blur'}, 'blur', 5000);
        expect((t as any).buf.at(-1).data).toEqual({event: 'blur', repeats: 19});
        now.mockRestore();
    });

    it('report stats are deltas over the window; per-interval audio level; a dead mic is reported once', async () => {
        let ts = 0;
        let energy = 0;
        let bytes = 0;
        const track: StatsTrack = {local: true,
            source: 'mic',
            muted: false,
            getRTCStatsReport: async () => report([
                {id: 'ms', type: 'media-source', kind: 'audio', timestamp: ts, totalAudioEnergy: energy, totalSamplesDuration: ts / 1000},
                {id: 'out', type: 'outbound-rtp', kind: 'audio', timestamp: ts, bytesSent: bytes, packetsSent: bytes / 100},
            ])};
        const t = new CallTelemetry(async () => ({ok: true, status: 202}), 'c', 'k', 'web', () => [track]);
        const now = jest.spyOn(performance, 'now');
        for (let i = 0; i <= 4; i++) {
            ts = i * 10_000;
            bytes = i * 50_000;
            now.mockReturnValue(ts);
            energy += i === 1 ? 0.01 * 10 : 0; // speech in the first interval, then digital silence
            // eslint-disable-next-line no-await-in-loop
            await t.collectStats();
        }
        const evs = (t as any).buf.filter((r: any) => r.kind === 'device_event');
        expect(evs).toEqual([expect.objectContaining({data: {device: 'mic', event: 'silent_mic', source: 'self'}})]);
        const firstLevel = (t as any).buf.filter((r: any) => r.kind === 'webrtc_stats')[1].data.stats.find((x: any) => x.type === 'media-source').audioLevel;
        expect(firstLevel).toBeCloseTo(0.1);
        ts = 45_000;
        bytes = 225_000;
        now.mockReturnValue(ts);
        const w = await t.windowStats();
        const out: any = w.stats.find((x: any) => x.type === 'outbound-rtp');
        expect(w.window_ms).toBe(35_000); // the newest sample at least ~30 s old (t=10 s)
        expect(out.bytes).toBe(175_000);
        expect(JSON.stringify(w.stats)).not.toContain('"id"');
        now.mockRestore();
    });

    it('names who muted: a pending source, else a moderator', () => {
        const t = new CallTelemetry(async () => ({ok: true, status: 202}), 'c', 'k');
        t.markSource('embed');
        expect((t as any).takeSource(true)).toBe('embed');
        expect((t as any).takeSource(true)).toBe('remote');
        expect((t as any).takeSource(false)).toBe('system');
    });
});
