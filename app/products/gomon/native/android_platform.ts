// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Track} from 'livekit-client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {defineMessages} from 'react-intl';
import {AppState, DeviceEventEmitter, NativeModules, Platform} from 'react-native';

import {setGomonMinimized} from '@gomon/store';
import {logWarning} from '@utils/log';

import {videoViewOf} from './android_pip';

import type {TileInfo} from './stage';
import type {NativeCall} from './use_call';

/** calls-native's Android-only MMCallsPlatform (Core-Telecom, call notification state, PiP). */
type PlatformModule = {
    startCall: (channelId: string, title: string, video: boolean) => Promise<boolean>;
    endCall: () => void;
    setCallState: (muted: boolean, sharing: boolean) => void;
    setPip: (enabled: boolean, width: number, height: number) => void;
    isInPip: () => Promise<boolean>;
};
const native: PlatformModule | undefined = Platform.OS === 'android' ? NativeModules.MMCallsPlatform : undefined;

export const TelecomEvents = {
    Mute: 'GomonTelecomMute',
    Answer: 'GomonTelecomAnswer',
    Disconnect: 'GomonTelecomDisconnect',
    Hold: 'GomonTelecomHold',
    Pip: 'GomonPip',
    Action: 'GomonCallAction',
} as const;

export const androidMessages = defineMessages({
    shareScreen: {id: 'gomon.android.share_screen', defaultMessage: 'Share screen'},
    stopShare: {id: 'gomon.android.stop_share', defaultMessage: 'Stop sharing'},
    sharing: {id: 'gomon.android.sharing', defaultMessage: 'You are sharing your screen'},
});

/**
 * Registers the call with Android Telecom (answers the pushed ring of this channel). Resolves
 * false on iOS, before API 28 or without Telecom: the manual audio routing stays then.
 */
export async function startTelecomCall(channelId: string, title: string, video: boolean) {
    if (!native) {
        return false;
    }
    try {
        return await native.startCall(channelId, title, video);
    } catch (e) {
        logWarning('gomon: telecom', e);
        return false;
    }
}

export function endTelecomCall() {
    native?.endCall();
}

/** react-native-webrtc's MediaStreamTrack.release(). */
type Releasable = {release?: () => void};

// LiveKit only stops the track; releasing it lets the WebRTC library drop its mediaProjection service.
async function setSharing(c: NativeCall, on: boolean) {
    const lp = c.room.localParticipant;
    const track = lp.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack as Releasable | undefined;
    await lp.setScreenShareEnabled(on);
    if (!on) {
        track?.release?.();
    }
}

const stopShare = (c: NativeCall) => setSharing(c, false).catch((e) => logWarning('gomon: stop share', e));

/**
 * The Android side of the native call screen: mute both ways with the system (Bluetooth/car,
 * Telecom hold), the call notification's and PiP's actions, PiP auto-enter while video shows,
 * which video to render (all / the PiP tile / none in the background) and screen sharing.
 */
export function useAndroidCallPlatform(nc: NativeCall, minimized: boolean, pipTile?: TileInfo) {
    const [pip, setPip] = useState(false);
    const [appState, setAppState] = useState<string>(AppState.currentState);
    const ncRef = useRef(nc);
    ncRef.current = nc;
    const local = nc.room.localParticipant;
    const sharing = local.isScreenShareEnabled;

    useEffect(() => {
        native?.setCallState(!nc.micOn, sharing);
    }, [nc.micOn, sharing]);

    useEffect(() => {
        if (!native) {
            return undefined;
        }
        native.isInPip().then(setPip).catch(() => undefined);
        const subs = [
            DeviceEventEmitter.addListener(TelecomEvents.Mute, ({muted}: {muted: boolean}) => {
                if (muted === ncRef.current.micOn) {
                    ncRef.current.setMic(!muted);
                }
            }),
            DeviceEventEmitter.addListener(TelecomEvents.Hold, ({held}: {held: boolean}) => {
                if (held && ncRef.current.micOn) {
                    ncRef.current.setMic(false);
                }
            }),
            DeviceEventEmitter.addListener(TelecomEvents.Action, ({action}: {action: string}) => {
                const c = ncRef.current;
                if (action === 'toggleMute') {
                    c.setMic(!c.micOn);
                } else if (action === 'stopShare') {
                    stopShare(c);
                }
            }),
            DeviceEventEmitter.addListener(TelecomEvents.Pip, ({active, dismissed}: {active: boolean; dismissed: boolean}) => {
                setPip(active);
                if (dismissed) {
                    setGomonMinimized(true);
                }
            }),
            AppState.addEventListener('change', setAppState),

        ];
        return () => subs.forEach((s) => s.remove());
    }, []);

    // PiP (and the screen kept on) while the full-screen call shows video.
    const dims = pipTile?.pub?.dimensions;
    const enabled = nc.connected && !minimized && Boolean(pipTile);
    useEffect(() => {
        native?.setPip(enabled, dims?.width ?? 0, dims?.height ?? 0);
    }, [enabled, dims?.width, dims?.height]);
    useEffect(() => () => native?.setPip(false, 0, 0), []);

    // Leaving the call while sharing: release the capture too (see setSharing).
    const shareTrack = useRef<Releasable>(undefined);
    if (sharing) {
        shareTrack.current = local.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack as Releasable | undefined;
    }
    useEffect(() => () => shareTrack.current?.release?.(), []);

    const toggleShare = useCallback(async () => {
        try {
            await setSharing(ncRef.current, !sharing);
        } catch (e) {
            // the person declined the system's capture prompt
            logWarning('gomon: screen share', e);
        }
    }, [sharing]);

    return {view: native ? videoViewOf(pip, appState) : 'full', sharing, toggleShare, canShare: Boolean(native)};
}
