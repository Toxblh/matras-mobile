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

// The call shown by the gomon call screen right now (one at a time).
export type CurrentGomonCall = {serverUrl: string; channelId: string; callId?: string};
let currentCall: CurrentGomonCall | undefined;
export const getCurrentGomonCall = () => currentCall;
export const setCurrentGomonCall = (call?: CurrentGomonCall) => {
    currentCall = call;
};
