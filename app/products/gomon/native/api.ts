// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {urlOrigin} from '@gomon/utils';
import {generateId} from '@utils/general';

// The gomon media API as apps/meeting-web uses it (comms repo, src/api.ts + main.tsx).
// The API is served from the same origin as the plugin's join_url.

export type JoinTarget = {origin: string; callId: string; code: string};
export type JoinResult = {connection_id: string; livekit_url: string; token: string; expires_at: string};

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

async function post<T>(origin: string, path: string, token: string | undefined, body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {'Content-Type': 'application/json'};
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(origin + path, {method: 'POST', headers, body: JSON.stringify(body)});
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(json?.error?.message || `${path}: HTTP ${res.status}`);
    }
    return json as T;
}

// Commands carry an idempotency key, one per user action.
const command = <T>(origin: string, path: string, token: string, body: Record<string, unknown> = {}) =>
    post<T>(origin, path, token, {idempotency_key: generateId(), ...body});

/** One-time handoff code → session token (and the call it was issued for). */
export const redeemHandoff = (origin: string, code: string) =>
    post<{token: string; call_id?: string}>(origin, '/v1/handoff/redeem', undefined, {code});

export const joinCall = (origin: string, token: string, callId: string, deviceId: string) =>
    command<JoinResult>(origin, `/v1/calls/${encodeURIComponent(callId)}/join`, token, {device_id: deviceId});

export const leaveConnection = (origin: string, token: string, connectionId: string) =>
    command(origin, `/v1/connections/${encodeURIComponent(connectionId)}/leave`, token);
