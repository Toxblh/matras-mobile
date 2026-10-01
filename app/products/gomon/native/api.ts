// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {urlOrigin} from '@gomon/utils';
import {generateId} from '@utils/general';

import {humanError, type ChatFile, type Conf, type DirEmp, type DirPartner} from './call_core';

// The gomon media API as apps/meeting-web uses it (comms repo, src/api.ts + main.tsx).
// The API is served from the same origin as the plugin's join_url.

export type JoinTarget = {origin: string; callId: string; code: string};
export type JoinResult = {connection_id: string; livekit_url: string; token: string; expires_at: string};

export type CallState = 'STARTING' | 'ACTIVE' | 'EMPTY_GRACE' | 'ENDING' | 'ENDED' | 'FAILED';
export interface Connection {connection_id: string; principal_id?: string; kind: 'employee' | 'guest' | 'room'; display_name: string; state: string; device_id?: string}
export interface Invitation {invitation_id: string; invitee_id: string; invitee_name: string; state: string}
export interface Admission {admission_id: string; display_name: string; state: string}
export interface Call {
    call_id: string; state: CallState; title: string; host_id?: string; cohost_ids?: string[];
    my_role: 'host' | 'cohost' | 'participant' | 'invitee' | 'guest' | 'none';
    connections: Connection[]; invitations?: Invitation[]; code?: string; meet_url?: string;
    conf?: Conf; locked?: boolean; lobby?: Admission[]; pin?: string; created_at?: string;
}
export interface UserRef {id: string; username: string; display_name: string}

export const isLiveCall = (c: Pick<Call, 'state'>) => ['STARTING', 'ACTIVE', 'EMPTY_GRACE'].includes(c.state);

/**
 * An API error with the server's code (`invalid_transition`, `forbidden`…) and HTTP status (0 = no
 * network). The message is for people (Russian by code, as on the web); `raw` is the server's.
 */
export class ApiError extends Error {
    raw: string;
    constructor(public status: number, public code: string, message: string, public details?: {max_bytes?: number}) {
        super(humanError(code, message));
        this.raw = message;
    }
}

/** A local file to send into the meeting chat (a picker's result). */
export type LocalFile = {uri: string; name: string; mime?: string; size?: number};

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
            throw new ApiError(res.status, json?.error?.code ?? 'internal', json?.error?.message || `${path}: HTTP ${res.status}`, json?.error?.details);
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
    diagnostics = (body: unknown) => this.req<{accepted?: number; report_id?: string}>('POST', '/v1/diagnostics', body);

    // moderation (host / co-hosts), as meeting-web's InCall and conf extension
    private c = (callId: string) => `/v1/calls/${encodeURIComponent(callId)}`;
    lock = (callId: string, locked: boolean) => this.cmd(`${this.c(callId)}/lock`, {locked});
    cohost = (callId: string, userId: string) => this.cmd(`${this.c(callId)}/cohosts`, {user_id: userId});
    remove = (callId: string, connectionId: string) => this.cmd(`${this.c(callId)}/remove`, {connection_id: connectionId});
    mute = (callId: string, connectionId: string) => this.cmd(`${this.c(callId)}/mute`, {connection_id: connectionId});
    muteAll = (callId: string) => this.cmd<{muted_connections: number}>(`${this.c(callId)}/mute-all`);
    requestUnmute = (callId: string, connectionId: string) => this.cmd<{sent: boolean; mic_on: boolean}>(`${this.c(callId)}/request-unmute`, {connection_id: connectionId});
    lowerHand = (callId: string, connectionId?: string) => this.cmd(`${this.c(callId)}/hands/lower`, connectionId ? {connection_id: connectionId} : {all: true});
    admission = (id: string, action: 'admit' | 'deny') => this.cmd(`/v1/admissions/${encodeURIComponent(id)}/${action}`);
    guestLink = (callId: string) => this.cmd<{link_id: string; url_token: string; url?: string; expires_at: string}>(`${this.c(callId)}/guest-links`, {ttl_seconds: 86400});
    revokeLink = (linkId: string) => this.cmd(`/v1/guest-links/${encodeURIComponent(linkId)}/revoke`);

    // recording
    recStart = (callId: string, body: Record<string, unknown>) => this.cmd(`${this.c(callId)}/recording/start`, body);
    recStop = (callId: string) => this.cmd(`${this.c(callId)}/recording/stop`);
    recording = (id: string) => this.req<{state: string; outcome_reason: string | null}>('GET', `/v1/recordings/${encodeURIComponent(id)}`);

    // telephony (SIP)
    sipDial = (callId: string, body: Record<string, unknown>) => this.cmd(`${this.c(callId)}/sip/dial`, body);
    sipLeg = (legId: string, action: 'cancel' | 'hangup' | 'redial') => this.cmd(`/v1/sip/legs/${encodeURIComponent(legId)}/${action}`);
    sipDirectory = (q: string) => this.req<{employees: DirEmp[]; partners: DirPartner[]}>('GET', `/v1/sip/directory?q=${encodeURIComponent(q)}`);

    /** A chat file as the raw request body (as the web's XHR upload), with progress 0…1. */
    async upload(path: string, file: LocalFile, onProgress: (p: number) => void): Promise<ChatFile> {
        const blob = await (await fetch(file.uri)).blob();
        return new Promise((resolve, reject) => {
            const x = new XMLHttpRequest();
            x.open('POST', this.origin + path);
            if (this.token) {
                x.setRequestHeader('Authorization', `Bearer ${this.token}`);
            }
            x.setRequestHeader('Content-Type', 'application/octet-stream');
            x.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(e.loaded / e.total);
                }
            };
            x.onload = () => {
                let j: {file?: ChatFile; error?: {code?: string; message?: string; details?: {max_bytes?: number}}} = {};
                try {
                    j = JSON.parse(x.responseText);
                } catch {
                    // not JSON
                }
                if (x.status >= 200 && x.status < 300 && j.file) {
                    resolve(j.file);
                } else {
                    reject(new ApiError(x.status, j.error?.code ?? 'internal', j.error?.message ?? `HTTP ${x.status}`, j.error?.details));
                }
            };
            x.onerror = () => reject(new ApiError(0, 'network', 'network'));
            x.send(blob);
        });
    }

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
