// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative from '@mattermost/calls-native';
import {isDevice} from 'expo-device';
import {useEffect, useRef, useState} from 'react';
import {Platform} from 'react-native';

import {setCurrentCallKitCall, takeCallKitAnswered} from '@gomon/callkit';
import {logWarning} from '@utils/log';

import type {MuteSource} from './shared/telemetry';
import type {CurrentGomonCall} from '@gomon/store';

type Options = {
    connected: boolean;
    micOn: boolean;
    setMic: (on: boolean, from?: MuteSource) => void;
};

// The LiveKit audio engine runs only while WebRTC's audio is enabled (calls-native bootstrap sets
// manual audio): by CallKit's didActivate, or here when there is no CallKit call.
const audioWithoutCallKit = (e: unknown) => {
    logWarning('gomon: no CallKit call, audio without it', e);
    CallsNative.startAudioSession().catch((err: unknown) => logWarning('gomon: audio session', err));
};

/**
 * iOS: the native gomon call is a CallKit call — lock screen and Dynamic Island controls, the
 * system's mute and end buttons, and the audio session CallKit activates (a call started in the
 * app reports an outgoing CallKit call, one answered on the CallKit screen adopts it). If CallKit
 * refuses, the call still runs with the audio session configured by calls-native.
 */
export function useCallKitSession(call: CurrentGomonCall, {connected, micOn, setMic}: Options) {
    const [uuid, setUuid] = useState<string>();
    const outgoing = useRef(false);
    const setMicRef = useRef(setMic);
    setMicRef.current = setMic;

    useEffect(() => {
        if (Platform.OS !== 'ios') {
            return undefined;
        }
        let gone = false;
        let id: string | undefined;
        const sub = CallsNative.onMuteChanged((e) => {
            if (e.uuid === id) {
                setMicRef.current(!e.muted, 'system');
            }
        });

        const adopted = takeCallKitAnswered(call.serverUrl, call.channelId);

        // The simulator has no CallKit UI to host an outgoing call and disconnects it at once
        // ("there wont be a UI to host the call").
        let report: Promise<string>;
        if (adopted) {
            report = Promise.resolve(adopted);
        } else if (isDevice) {
            report = CallsNative.reportOutgoingCall({
                channelId: call.channelId || call.title,
                calleeName: call.title,
            }).then((r) => {
                outgoing.current = true;
                return r.uuid;
            });
        } else {
            report = Promise.reject(new Error('simulator'));
        }
        report.then((u) => {
            if (gone) {
                CallsNative.reportEnded(u, 'remoteEnded');
                return;
            }
            id = u;
            setCurrentCallKitCall(u);
            setUuid(u);
        }).catch(audioWithoutCallKit);

        return () => {
            gone = true;
            sub.remove();
            if (id) {
                CallsNative.reportEnded(id, 'remoteEnded');
                setCurrentCallKitCall(undefined);
            }
        };

    // Once per call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (uuid && connected && outgoing.current) {
            CallsNative.reportConnected(uuid);
        }
    }, [uuid, connected]);

    // The app's mute shows on the CallKit screen (CallKit's own echo is dropped natively).
    useEffect(() => {
        if (uuid) {
            CallsNative.setMuted(uuid, !micOn).catch(() => undefined);
        }
    }, [uuid, micOn]);
}
