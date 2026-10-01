// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type CallActionPayload, type IncomingCallPayload, type VoIPTokenUpdated} from '@mattermost/calls-native';
import {DeviceEventEmitter, Platform} from 'react-native';

import {storeVoIPDeviceToken} from '@actions/app/global';
import {Device} from '@constants';
import DatabaseManager from '@database/manager';
import {acceptGomonFromPush, declineGomonFromPush} from '@gomon/actions';
import {isCurrentCallKitCall} from '@gomon/callkit';
import {GOMON_LEAVE} from '@gomon/constants';
import {getCurrentGomonCall, type CurrentGomonCall} from '@gomon/store';

jest.mock('@actions/app/global', () => ({
    storeVoIPDeviceToken: jest.fn(),
}));
jest.mock('@gomon/store', () => ({
    getCurrentGomonCall: jest.fn(),
}));
jest.mock('@gomon/callkit', () => ({
    isCurrentCallKitCall: jest.fn(),
    setCallKitAnswered: jest.fn(),
}));
jest.mock('@gomon/actions', () => ({
    acceptGomonFromPush: jest.fn(),
    declineGomonFromPush: jest.fn(),
}));
jest.mock('@utils/log', () => ({
    logDebug: jest.fn(),
    logError: jest.fn(),
    logInfo: jest.fn(),
}));

// Loads (or reloads) the singleton and returns the handlers the init()
// call registered, so we can drive each event handler directly.
const loadAndInit = () => {
    jest.isolateModules(() => {
        const CallsNativeInit = require('./calls_native').default;
        CallsNativeInit.init();
    });
    const calls = (CallsNative as any);
    return {
        onVoIPTokenUpdated: calls.onVoIPTokenUpdated.mock.calls.at(-1)?.[0] as (e: VoIPTokenUpdated) => Promise<void>,
        onIncomingCall: calls.onIncomingCall.mock.calls.at(-1)?.[0] as (e: IncomingCallPayload) => void,
        onCallAnswered: calls.onCallAnswered.mock.calls.at(-1)?.[0] as (e: CallActionPayload) => Promise<void>,
        onCallDeclined: calls.onCallDeclined.mock.calls.at(-1)?.[0] as (e: CallActionPayload) => Promise<void>,
        onCallEnded: calls.onCallEnded.mock.calls.at(-1)?.[0] as (e: CallActionPayload) => void,
    };
};

let originalOS: typeof Platform.OS;

beforeEach(() => {
    jest.clearAllMocks();
    originalOS = Platform.OS;
    Object.defineProperty(Platform, 'OS', {get: () => 'ios'});
});

afterEach(() => {
    Object.defineProperty(Platform, 'OS', {get: () => originalOS});
});

describe('init', () => {
    it('subscribes to the token and CallKit events', () => {
        loadAndInit();
        expect(CallsNative.onVoIPTokenUpdated).toHaveBeenCalledTimes(1);
        expect(CallsNative.onIncomingCall).toHaveBeenCalledTimes(1);
        expect(CallsNative.onCallAnswered).toHaveBeenCalledTimes(1);
        expect(CallsNative.onCallDeclined).toHaveBeenCalledTimes(1);
        expect(CallsNative.onCallEnded).toHaveBeenCalledTimes(1);
    });
});

describe('onVoIPTokenUpdated', () => {
    it('stores empty string when token is empty (invalidation)', async () => {
        const {onVoIPTokenUpdated} = loadAndInit();
        await onVoIPTokenUpdated({token: ''});
        expect(storeVoIPDeviceToken).toHaveBeenCalledWith('');
    });

    // The shared expo-application mock in test/setup.ts sets applicationId
    // to 'com.mattermost.rnbeta', so isBetaApp is true by default in tests.
    it('stores beta-prefixed token under the default (beta) test config', async () => {
        const {onVoIPTokenUpdated} = loadAndInit();
        await onVoIPTokenUpdated({token: 'abc123'});
        expect(storeVoIPDeviceToken).toHaveBeenCalledWith(`${Device.PUSH_NOTIFY_APPLE_REACT_NATIVE}beta-v2:abc123`);
    });

    it('stores the token with the prefix of the app id (apple_matras for ru.toxblh.matras)', async () => {
        let handler: ((e: VoIPTokenUpdated) => Promise<void>) | undefined;
        jest.isolateModules(() => {
            jest.doMock('@utils/push_platform', () => ({pushPlatformPrefix: () => 'apple_matras'}));
            const CallsNativeInit = require('./calls_native').default;
            CallsNativeInit.init();
            const mockedOnUpdated = CallsNative.onVoIPTokenUpdated as jest.Mock;
            const lastCall = mockedOnUpdated.mock.calls[mockedOnUpdated.mock.calls.length - 1];
            handler = lastCall?.[0];
        });
        await handler!({token: 'abc123'});
        expect(storeVoIPDeviceToken).toHaveBeenCalledWith('apple_matras-v2:abc123');
    });
});

const rung = {uuid: 'u1', channelId: 'ch1', serverId: 'srv1', postId: '', threadId: '', callerId: '', callerName: 'Анна'};

describe('onCallAnswered', () => {
    it('ends a CallKit call it knows nothing about', async () => {
        const {onCallAnswered} = loadAndInit();
        await onCallAnswered({uuid: 'u1'});
        expect(CallsNative.reportEnded).toHaveBeenCalledWith('u1', 'failed');
        expect(acceptGomonFromPush).not.toHaveBeenCalled();
    });

    it('accepts the rung gomon call through the plugin and keeps CallKit when it opened', async () => {
        jest.spyOn(DatabaseManager, 'getServerUrlFromIdentifier').mockResolvedValue('https://mm');
        jest.mocked(getCurrentGomonCall).mockReturnValue({serverUrl: 'https://mm', channelId: 'ch1'} as CurrentGomonCall);
        const {onIncomingCall, onCallAnswered} = loadAndInit();
        onIncomingCall(rung);
        await onCallAnswered({uuid: 'u1'});
        expect(acceptGomonFromPush).toHaveBeenCalledWith(expect.anything(), 'https://mm', 'ch1');
        expect(CallsNative.reportEnded).not.toHaveBeenCalled();
    });

    it('ends CallKit when the call did not open', async () => {
        jest.spyOn(DatabaseManager, 'getServerUrlFromIdentifier').mockResolvedValue('https://mm');
        jest.mocked(getCurrentGomonCall).mockReturnValue(undefined);
        const {onIncomingCall, onCallAnswered} = loadAndInit();
        onIncomingCall(rung);
        await onCallAnswered({uuid: 'u1'});
        expect(CallsNative.reportEnded).toHaveBeenCalledWith('u1', 'failed');
    });
});

describe('onCallDeclined', () => {
    it('declines the invitation through the plugin', async () => {
        jest.spyOn(DatabaseManager, 'getServerUrlFromIdentifier').mockResolvedValue('https://mm');
        const {onIncomingCall, onCallDeclined} = loadAndInit();
        onIncomingCall(rung);
        await onCallDeclined({uuid: 'u1'});
        expect(declineGomonFromPush).toHaveBeenCalledWith('https://mm', 'ch1');
    });
});

describe('onCallEnded', () => {
    it('leaves the gomon call on Android', () => {
        Object.defineProperty(Platform, 'OS', {get: () => 'android'});
        jest.mocked(getCurrentGomonCall).mockReturnValue({} as CurrentGomonCall);
        const emit = jest.spyOn(DeviceEventEmitter, 'emit');
        const {onCallEnded} = loadAndInit();
        onCallEnded({uuid: 'u1'});
        expect(emit).toHaveBeenCalledWith(GOMON_LEAVE);
    });

    it('leaves the gomon call when its CallKit call is ended on iOS, not another one', () => {
        jest.mocked(getCurrentGomonCall).mockReturnValue({} as CurrentGomonCall);
        const emit = jest.spyOn(DeviceEventEmitter, 'emit');
        jest.mocked(isCurrentCallKitCall).mockImplementation((uuid) => uuid === 'u2');
        const {onCallEnded} = loadAndInit();
        onCallEnded({uuid: 'u1'});
        expect(emit).not.toHaveBeenCalledWith(GOMON_LEAVE);
        onCallEnded({uuid: 'u2'});
        expect(emit).toHaveBeenCalledWith(GOMON_LEAVE);
    });

    it('does nothing without a gomon call', () => {
        Object.defineProperty(Platform, 'OS', {get: () => 'android'});
        jest.mocked(getCurrentGomonCall).mockReturnValue(undefined);
        const emit = jest.spyOn(DeviceEventEmitter, 'emit');
        const {onCallEnded} = loadAndInit();
        onCallEnded({uuid: 'u1'});
        expect(emit).not.toHaveBeenCalledWith(GOMON_LEAVE);
    });
});
