// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: copied from comms apps/meeting-web/src/call/connection.test.ts (comms dc0ae61); keep in sync until
// the shared comms-core package (phase 4). Only the code style differs.

import {initial, reduce, type ConnEvent} from './connection';

const run = (events: ConnEvent[]) => events.reduce(reduce, initial());

describe('client SM3 reducer', () => {
    it('prejoin → authorizing → connecting → connected (SM3-T01, T02, T04)', () => {
        const s = run([{type: 'JoinRequested'}, {type: 'TokenIssued'}, {type: 'ParticipantJoined'}]);
        expect(s.state).toBe('CONNECTED');
        expect(s.trail).toEqual(['SM3-T01', 'SM3-T02', 'SM3-T04']);
    });

    it("reconnect keeps the user's mute and camera intent (INV09)", () => {
        let s = run([{type: 'JoinRequested'}, {type: 'TokenIssued'}, {type: 'ParticipantJoined'}]);
        s = reduce(s, {type: 'SetIntent', mic: false, cam: false});
        s = reduce(s, {type: 'TransportLost'});
        expect(s.state).toBe('RECONNECTING');
        s = reduce(s, {type: 'TransportRestored'});
        expect(s.state).toBe('CONNECTED');
        expect(s.intent).toEqual({mic: false, cam: false});
    });

    it('gives up after reconnect failure (SM3-T08)', () => {
        const s = run([{type: 'JoinRequested'}, {type: 'TokenIssued'}, {type: 'ParticipantJoined'}, {type: 'TransportLost'}, {type: 'ReconnectGaveUp'}]);
        expect(s.state).toBe('DISCONNECTED');
        expect(s.trail[s.trail.length - 1]).toBe('SM3-T08');
    });

    it('server verdicts are terminal and reasoned', () => {
        const base = run([{type: 'JoinRequested'}, {type: 'TokenIssued'}, {type: 'ParticipantJoined'}]);
        expect(reduce(base, {type: 'Removed'}).state).toBe('REMOVED');
        expect(reduce(base, {type: 'SessionEnded'}).state).toBe('SESSION_ENDED');
        expect(reduce(base, {type: 'AuthRevoked'}).state).toBe('AUTH_REVOKED');
    });

    it('rejects undeclared transitions instead of faking success', () => {
        const s = initial();
        const r = reduce(s, {type: 'ParticipantJoined'});
        expect(r.state).toBe('PREJOIN');
        expect(r.error).toMatch(/not declared/);
        const ended = reduce(run([{type: 'JoinRequested'}, {type: 'TokenIssued'}, {type: 'ParticipantJoined'}]), {type: 'SessionEnded'});
        expect(reduce(ended, {type: 'TransportRestored'}).state).toBe('SESSION_ENDED');
    });

    it('join rejection carries the server reason', () => {
        const s = run([{type: 'JoinRequested'}, {type: 'JoinRejected', reason: 'not_permitted'}]);
        expect(s.state).toBe('DISCONNECTED');
        expect(s.reason).toBe('not_permitted');
    });
});
