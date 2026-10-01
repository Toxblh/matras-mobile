// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {urlOrigin} from '@gomon/utils';
import {generateId} from '@utils/general';

import type {Conf} from './call_core';

// The gomon media API as apps/meeting-web uses it (comms repo, src/api.ts + main.tsx).
// The API is served from the same origin as the plugin's join_url.

export type JoinTarget = {origin: string; callId: string; code: string};
export type JoinResult = {connection_id: string; livekit_url: string; token: string; expires_at: string};

export type CallState = 'STARTING' | 'ACTIVE' | 'EMPTY_GRACE' | 'ENDING' | 'ENDED' | 'FAILED';
export interface Connection {connection_id: string; principal_id?: string; kind: 'employee' | 'guest' | 'room'; display_name: string; state: string; device_id?: string}
export interface Invitation {invitation_id: string; invitee_id: string; invitee_name: string; state: string}
export interface Call {
    call_id: string; state: CallState; title: string; host_id?: string; cohost_ids?: string[];
    my_role: 'host' | 'cohost' | 'participant' | 'invitee' | 'guest' | 'none';
    connections: Connection[]; invitations?: Invitation[]; code?: string; meet_url?: string;
    conf?: Conf;
}
export interface UserRef {id: string; username: string; display_name: string}

export const isLiveCall = (c: Pick<Call, 'state'>) => ['STARTING', 'ACTIVE', 'EMPTY_GRACE'].includes(c.state);

/** An API error with the server's code (`invalid_transition`, `forbidden`…) and HTTP status (0 = no network). */
export class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
        super(message);
    }
}

// `https://gomon…/call/<id>#code=<one-time handoff code>`
export function parseJoinUrl(joinUrl: string): JoinTarget | undefined {
    const origin = urlOrigin(joinUrl);
    const call = (/^[^?#]*\/call\/([^/?#]+)/).exec(joinUrl);
    const code = (/#(?:.*&)?code=([0-9a-f]+)/i).exec(joinUrl);
    if (!origin || !call || !code) {
        return undefined;
    }
    return {origin, callId: decodeURIComponent(call[1]), code: code[1]};
}

export class GomonApi {
    constructor(public origin: string, public token?: string) {}

    async req<T>(method: string, path: string, body?: unknown): Promise<T> {
        const headers: Record<string, string> = {'Content-Type': 'application/json'};
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        let res: Response;
        try {
            res = await fetch(this.origin + path, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
        } catch (e) {
            throw new ApiError(0, 'network', (e as Error)?.message || 'network');
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new ApiError(res.status, json?.error?.code ?? 'internal', json?.error?.message || `${path}: HTTP ${res.status}`);
        }
        return json as T;
    }

    // Commands carry an idempotency key, one per user action.
    cmd<T>(path: string, body: Record<string, unknown> = {}) {
        return this.req<T>('POST', path, {idempotency_key: generateId(), ...body});
    }

    /** One-time handoff code → session token (and the call it was issued for). */
    async redeem(code: string) {
        const r = await this.req<{token: string; call_id?: string}>('POST', '/v1/handoff/redeem', {code});
        this.token = r.token;
        return r;
    }

    join = (callId: string, deviceId: string) => this.cmd<JoinResult>(`/v1/calls/${encodeURIComponent(callId)}/join`, {device_id: deviceId});
    leave = (connectionId: string) => this.cmd(`/v1/connections/${encodeURIComponent(connectionId)}/leave`);
    end = (callId: string) => this.cmd(`/v1/calls/${encodeURIComponent(callId)}/end`);
    call = (callId: string) => this.req<Call>('GET', `/v1/calls/${encodeURIComponent(callId)}`);
    hand = (callId: string, raised: boolean) => this.cmd(`/v1/calls/${encodeURIComponent(callId)}/hand`, {raised});
    react = (callId: string, reaction: string, connectionId: string) => this.req('POST', `/v1/calls/${encodeURIComponent(callId)}/reactions`, {reaction, connection_id: connectionId});
    users = (q: string) => this.req<{users: UserRef[]}>('GET', `/v1/users?q=${encodeURIComponent(q)}`);
    invite = (callId: string, invitees: string[]) => this.cmd(`/v1/calls/${encodeURIComponent(callId)}/invitations`, {invitees});
    diagnostics = (body: unknown) => this.req('POST', '/v1/diagnostics', body);

    /**
     * The domain event stream (long poll), as meeting-web's Api.stream: `onEvent` for every batch
     * of events (the caller re-reads what it shows). Returns a stop function.
     */
    stream(deviceId: string, onEvents: () => void): () => void {
        let stopped = false;
        const loop = async () => {
            let cursor = -1;
            // eslint-disable-next-line no-unmodified-loop-condition -- set by the returned stop()
            while (!stopped) {
                try {
                    if (cursor < 0) {
                        // eslint-disable-next-line no-await-in-loop
                        cursor = (await this.req<{cursor: number}>('GET', '/v1/state')).cursor;
                    }
                    // eslint-disable-next-line no-await-in-loop
                    const j = await this.req<{events: unknown[]; cursor: number}>('GET', `/v1/events?after=${cursor}&wait=20&device_id=${encodeURIComponent(deviceId)}`);
                    cursor = j.cursor;
                    if (j.events.length && !stopped) {
                        onEvents();
                    }
                } catch (e) {
                    if ((e as ApiError).status === 410) {
                        cursor = -1; // the cursor is too old: start over from the snapshot
                    } else if ((e as ApiError).status === 401) {
                        return;
                    }
                    // eslint-disable-next-line no-await-in-loop
                    await new Promise((res) => setTimeout(res, 3000));
                }
            }
        };
        loop();
        return () => {
            stopped = true;
        };
    }
}
