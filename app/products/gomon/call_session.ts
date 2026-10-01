// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type AudioDeviceType, type AudioRoute} from '@mattermost/calls-native';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useIntl} from 'react-intl';
import {BackHandler, DeviceEventEmitter} from 'react-native';

import {GOMON_LEAVE} from '@gomon/constants';
import {foregroundServiceStart, foregroundServiceStop} from '@gomon/foreground_service';
import {endTelecomCall, startTelecomCall} from '@gomon/native/android_platform';
import {type CurrentGomonCall, setGomonMinimized} from '@gomon/store';
import {nextAudioRoute} from '@gomon/utils';
import {useCurrentScreen} from '@store/navigation_store';
import {logWarning} from '@utils/log';

/**
 * What every gomon call needs from the platform, whatever renders the media (WebView or
 * LiveKit): the foreground service, the voice audio session with its route, back = minimize,
 * the ongoing-call notification's "Hang up" and the duration tick of the minimized bar.
 */
export function useGomonCallSession(call: CurrentGomonCall, leave: () => void) {
    const {serverUrl, channelId, withCamera, minimized, title} = call;
    const intl = useIntl();
    const currentScreen = useCurrentScreen();
    const [audio, setAudio] = useState<AudioRoute>();
    const [now, setNow] = useState(Date.now);
    const audioRef = useRef<AudioRoute | undefined>(undefined);
    const pinnedRoute = useRef<AudioDeviceType | undefined>(undefined);
    const wantedRoute = useRef<AudioDeviceType | undefined>(undefined);
    const leaveRef = useRef(leave);
    leaveRef.current = leave;
    const fgCamera = useRef(withCamera);
    const fgMic = useRef(call.withMic);

    const selectAudio = useCallback((device: AudioDeviceType) => {
        pinnedRoute.current = device;
        wantedRoute.current = device;
        CallsNative.setAudioRoute(device);
    }, []);

    // WebRTC may reset the route when it opens the mic; the caller re-applies ours once joined.
    const reapplyRoute = useCallback(() => {
        if (wantedRoute.current) {
            CallsNative.setAudioRoute(wantedRoute.current);
        }
    }, []);

    // The camera (or a mic granted only mid-call) was switched on: the foreground service needs
    // that type too, or the capture stops in the background. The service picks its types from
    // the permissions granted by now.
    const mediaStarted = useCallback((cam: boolean, mic: boolean) => {
        if ((cam && !fgCamera.current) || (mic && !fgMic.current)) {
            fgCamera.current ||= cam;
            fgMic.current ||= mic;
            foregroundServiceStart(intl, fgCamera.current, serverUrl, channelId);
        }
    }, [intl, serverUrl, channelId]);

    // Call lifecycle = the calling component's, which the host keys by the store's call.
    useEffect(() => {
        foregroundServiceStart(intl, withCamera, serverUrl, channelId);

        // Voice-call audio session (MODE_IN_COMMUNICATION + focus) so the call audio can be
        // routed to earpiece / headset / speaker.
        const onRoute = (route: AudioRoute) => {
            const available = route.availableAudioDeviceList;
            const next = nextAudioRoute(available, audioRef.current?.availableAudioDeviceList ?? [], route.selectedAudioDevice, pinnedRoute.current, withCamera);
            if (pinnedRoute.current && !available.includes(pinnedRoute.current)) {
                pinnedRoute.current = undefined;
            }
            audioRef.current = route;
            setAudio(route);
            if (next) {
                wantedRoute.current = next;
            }
            if (next && next !== route.selectedAudioDevice) {
                CallsNative.setAudioRoute(next);
            }
        };
        const routeSub = CallsNative.onAudioRouteChanged(onRoute);

        // Android: the call is registered with Telecom first, which then owns the routing.
        let ended = false;
        startTelecomCall(channelId, title, withCamera).
            then(async (telecom) => {
                if (ended) {
                    endTelecomCall();
                    return;
                }
                if (telecom) {
                    foregroundServiceStart(intl, fgCamera.current, serverUrl, channelId); // + the phoneCall type
                }
                await CallsNative.startAudioSession();
                onRoute(await CallsNative.getAudioRoute());
            }).
            catch((e) => logWarning('gomon: audio session', e));

        // "Hang up" on the ongoing-call notification (calls_native.ts).
        const sub = DeviceEventEmitter.addListener(GOMON_LEAVE, () => leaveRef.current());
        return () => {
            ended = true;
            sub.remove();
            routeSub.remove();
            CallsNative.stopAudioSession();
            endTelecomCall();
            foregroundServiceStop();
        };

    // Once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Back minimizes. Re-registered on screen changes so it stays the newest, first-called listener.
    useEffect(() => {
        if (minimized) {
            return undefined;
        }
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            setGomonMinimized(true);
            return true;
        });
        return () => sub.remove();
    }, [minimized, currentScreen]);

    // Duration tick, only while the bar shows it.
    useEffect(() => {
        if (!minimized) {
            return undefined;
        }
        setNow(Date.now());
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [minimized]);

    return {audio, selectAudio, reapplyRoute, mediaStarted, now};
}
