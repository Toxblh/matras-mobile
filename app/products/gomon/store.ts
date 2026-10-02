// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useState} from 'react';
import {BehaviorSubject} from 'rxjs';

export type GomonServerState = {
    pluginEnabled: boolean;

    // channelId → live call id
    calls: Record<string, string>;
};

const DEFAULT_STATE: GomonServerState = {pluginEnabled: false, calls: {}};
const subjects: Record<string, BehaviorSubject<GomonServerState>> = {};

const getSubject = (serverUrl: string) => {
    if (!subjects[serverUrl]) {
        subjects[serverUrl] = new BehaviorSubject(DEFAULT_STATE);
    }
    return subjects[serverUrl];
};

export const getGomonState = (serverUrl: string) => getSubject(serverUrl).value;
export const observeGomonState = (serverUrl: string) => getSubject(serverUrl).asObservable();

export const setGomonPluginEnabled = (serverUrl: string, pluginEnabled: boolean) => {
    const s = getSubject(serverUrl);
    if (s.value.pluginEnabled !== pluginEnabled) {
        s.next({...s.value, pluginEnabled});
    }
};

export const setGomonChannelCall = (serverUrl: string, channelId: string, callId?: string) => {
    const s = getSubject(serverUrl);
    if (s.value.calls[channelId] === callId) {
        return;
    }
    const calls = {...s.value.calls};
    if (callId) {
        calls[channelId] = callId;
    } else {
        delete calls[channelId];
    }
    s.next({...s.value, calls});
};

export const useGomonState = (serverUrl: string) => {
    const [state, setState] = useState(() => getGomonState(serverUrl));
    useEffect(() => {
        const sub = getSubject(serverUrl).subscribe(setState);
        return () => sub.unsubscribe();
    }, [serverUrl]);
    return state;
};

// The one active call, hosted by GomonCallHost above navigation.
export type CurrentGomonCall = {
    serverUrl: string;
    channelId: string;
    callId?: string;
    url: string;
    withCamera: boolean;

    /** False when the microphone permission was denied: the call is joined muted (listen-only). */
    withMic: boolean;
    locale: string;
    title: string;
    startedAt: number;
    minimized: boolean;

    /** matras: media through the LiveKit SDK instead of the WebView (prototype, `url` = join_url). */
    native?: boolean;

    /**
     * The gomon session the one-time code of `url` was redeemed for: a re-created call component
     * (retry after a network failure, a JS reload) joins with it instead of the spent code.
     */
    session?: {token: string; callId: string};
};
const currentCall = new BehaviorSubject<CurrentGomonCall | undefined>(undefined);
export const getCurrentGomonCall = () => currentCall.value;
export const setCurrentGomonCall = (call?: CurrentGomonCall) => currentCall.next(call);
export const setGomonMinimized = (minimized: boolean) => {
    const call = currentCall.value;
    if (call && call.minimized !== minimized) {
        currentCall.next({...call, minimized});
    }
};
export const setGomonCallSession = (url: string, session: {token: string; callId: string}) => {
    const call = currentCall.value;
    if (call?.url === url) {
        currentCall.next({...call, session});
    }
};
export const useCurrentGomonCall = () => {
    const [call, setCall] = useState(currentCall.value);
    useEffect(() => {
        const sub = currentCall.subscribe(setCall);
        return () => sub.unsubscribe();
    }, []);
    return call;
};
