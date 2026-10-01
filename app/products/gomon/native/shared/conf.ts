// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: the protocol part of comms apps/meeting-web/src/extensions/conf/model.ts (comms
// dc0ae61); keep in sync until the shared comms-core package (phase 4). The web reads the raw
// engine packets; RoomEvent.DataReceived gives the same (payload, sender, topic).

export interface Hand {connection_ids: string[]; display_name: string; kind: 'employee' | 'guest'; principal_id?: string; position?: number; raised_at?: string}
export interface Spot {connection_id: string; source: 'camera' | 'screen'}
export interface Caps {raise_hand: boolean; react: boolean; lower_other_hand: boolean; mute_other: boolean; mute_all: boolean; request_unmute: boolean; spotlight: boolean}
export interface Conf {hands: Hand[]; spotlight: Spot[]; my_hand: {raised: boolean; position: number | null}; can: Caps}

const NO_CAPS: Caps = {raise_hand: false, react: false, lower_other_hand: false, mute_other: false, mute_all: false, request_unmute: false, spotlight: false};
export const confOf = (call: unknown): Conf =>
    (call as {conf?: Conf} | null)?.conf ?? {hands: [], spotlight: [], my_hand: {raised: false, position: null}, can: NO_CAPS};

export const handOf = (conf: Conf, identity: string) => conf.hands.find((h) => h.connection_ids.includes(identity));

export const REACTIONS: Array<{key: string; emoji: string}> = [
    {key: 'thumbs_up', emoji: '👍'},
    {key: 'clap', emoji: '👏'},
    {key: 'heart', emoji: '❤️'},
    {key: 'laugh', emoji: '😂'},
    {key: 'wow', emoji: '😮'},
    {key: 'party', emoji: '🎉'},
];
export const emojiOf = (k: string) => REACTIONS.find((r) => r.key === k)?.emoji ?? '';

export const tileKey = (identity: string, source: 'camera' | 'screen') => identity + (source === 'screen' ? ':screen' : ':cam');

// Server control messages (LiveKit data packets on topic "conf").
export type ServerMsg =
    | {type: 'reaction'; reaction: string; connection_id: string; name: string; at: string}
    | {type: 'muted'; by: string; all?: boolean}
    | {type: 'unmute_request'; by: string; request_id: string};

/** Accept a packet only if the SFU delivered it without a sender (server-sent), on our topic.
 *  Participants cannot publish data at all (token grant), this is defence in depth. */
export function parseServerData(payload: Uint8Array, senderIdentity: string | undefined, topic: string | undefined): ServerMsg | null {
    if (senderIdentity || topic !== 'conf') {
        return null;
    }
    try {
        const m = JSON.parse(new TextDecoder().decode(payload));
        if (m && typeof m.type === 'string') {
            return m as ServerMsg;
        }
    } catch {
        // not ours
    }
    return null;
}
