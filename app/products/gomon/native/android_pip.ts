// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {TileInfo} from './stage';

/** What the call renders: everything, the one PiP tile, or no video at all (in the background). */
export type VideoView = 'full' | 'pip' | 'none';

/**
 * Remote video is decoded only where it is shown: adaptive stream pauses a track once no view
 * of it is mounted. In the background without PiP nothing is mounted; in PiP only one tile.
 */
export function videoViewOf(pip: boolean, appState: string): VideoView {
    if (pip) {
        return 'pip';
    }
    return appState === 'active' ? 'full' : 'none';
}

const hasVideo = (t: TileInfo) => Boolean(t.pub?.track) && !t.pub?.isMuted;

/**
 * The PiP tile: the latest remote screen share, else the active (or last) remote speaker with
 * video, else any remote video, else our own camera.
 */
export function pickPipTile(tiles: TileInfo[], lastSpeaker: string | null): TileInfo | undefined {
    const remote = tiles.filter((t) => !t.local && hasVideo(t));
    const shares = remote.filter((t) => t.screen);
    if (shares.length) {
        return shares[shares.length - 1];
    }
    const speaking = remote.find((t) => t.p.isSpeaking);
    return speaking ??
        remote.find((t) => t.p.identity === lastSpeaker) ??
        remote[0] ??
        tiles.find((t) => t.local && !t.screen && hasVideo(t));
}
