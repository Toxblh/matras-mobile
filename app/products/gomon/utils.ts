// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {AudioDevice, type AudioDeviceType} from '@mattermost/calls-native';

import {GOMON_PLUGIN_ID, LIVE_STATES} from './constants';

export type BridgeMessage =
    | {type: 'comms:ready'}
    | {type: 'comms:state'; mic: boolean; cam: boolean; people: number}
    | {type: 'comms:ended'; reason: string};

// `https://host/call/x#code=…` → `https://host/call/x?embed=rn[&cam=0]#code=…`
export function buildEmbedUrl(joinUrl: string, audioOnly = false) {
    const hashAt = joinUrl.indexOf('#');
    const base = hashAt === -1 ? joinUrl : joinUrl.slice(0, hashAt);
    const hash = hashAt === -1 ? '' : joinUrl.slice(hashAt);
    const query = `embed=rn${audioOnly ? '&cam=0' : ''}`;
    return `${base}${base.includes('?') ? '&' : '?'}${query}${hash}`;
}

export function urlOrigin(url: string) {
    const m = (/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/i).exec(url);
    return m ? m[1].toLowerCase() : '';
}

export function parseBridgeMessage(data: string): BridgeMessage | undefined {
    try {
        const msg = JSON.parse(data);
        switch (msg?.type) {
            case 'comms:ready':
                return {type: 'comms:ready'};
            case 'comms:state':
                return {type: 'comms:state', mic: Boolean(msg.mic), cam: Boolean(msg.cam), people: Number(msg.people) || 0};
            case 'comms:ended':
                return {type: 'comms:ended', reason: String(msg.reason ?? '')};
        }
    } catch {
        // not ours
    }
    return undefined;
}

export function bridgeCommand(action: 'mic' | 'leave') {
    return `window.dispatchEvent(new CustomEvent("comms:command",{detail:${JSON.stringify(action)}}));true;`;
}

export function isGomonPluginEnabled(manifests: Array<{id: string}> | undefined) {
    return Boolean(manifests?.some((m) => m.id === GOMON_PLUGIN_ID));
}

export function isLiveState(state: unknown) {
    return typeof state === 'string' && LIVE_STATES.has(state);
}

// Route to switch to after an audio device change, or undefined to leave it alone.
// A user pick sticks while its device exists; otherwise a new device or a lost
// active device re-routes to headset > speaker (video) / earpiece, as Calls does.
export function nextAudioRoute(
    available: AudioDeviceType[],
    previous: AudioDeviceType[],
    selected: AudioDeviceType,
    pinned: AudioDeviceType | undefined,
    video: boolean,
): AudioDeviceType | undefined {
    const lost = !available.includes(pinned ?? selected);
    if (pinned && !lost) {
        return undefined;
    }
    if (!lost && available.every((d) => previous.includes(d))) {
        return undefined;
    }
    if (available.includes(AudioDevice.Bluetooth)) {
        return AudioDevice.Bluetooth;
    }
    if (available.includes(AudioDevice.WiredHeadset)) {
        return AudioDevice.WiredHeadset;
    }
    return video ? AudioDevice.Speakerphone : AudioDevice.Earpiece;
}

// 65 s → "1:05", 3725 s → "1:02:05".
export function formatCallDuration(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
