// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras, iOS: the CallKit call behind the native gomon call. An incoming call answered on the
// CallKit screen is adopted by the call it opens (native/callkit_session.ts); a call started in
// the app reports its own outgoing CallKit call.

type Answered = {uuid: string; serverUrl: string; channelId: string};

let answered: Answered | undefined;
let current: string | undefined;

export const setCallKitAnswered = (a?: Answered) => {
    answered = a;
};

/** The answered CallKit call of this channel, once. */
export const takeCallKitAnswered = (serverUrl: string, channelId: string) => {
    const a = answered;
    if (a?.serverUrl === serverUrl && a.channelId === channelId) {
        answered = undefined;
        return a.uuid;
    }
    return undefined;
};

export const setCurrentCallKitCall = (uuid?: string) => {
    current = uuid;
};

export const isCurrentCallKitCall = (uuid: string) => uuid === current;
