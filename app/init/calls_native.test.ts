// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative, {type CallActionPayload, type VoIPTokenUpdated} from '@mattermost/calls-native';
import {DeviceEventEmitter, Platform} from 'react-native';

import {storeVoIPDeviceToken} from '@actions/app/global';
import {Device} from '@constants';
import {GOMON_LEAVE} from '@gomon/constants';
import {getCurrentGomonCall, type CurrentGomonCall} from '@gomon/store';

jest.mock('@actions/app/global', () => ({
    storeVoIPDeviceToken: jest.fn(),
}));
jest.mock('@gomon/store', () => ({
    getCurrentGomonCall: jest.fn(),
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
        onCallAnswered: calls.onCallAnswered.mock.calls.at(-1)?.[0] as (e: CallActionPayload) => void,
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
    it('subscribes to the token, answer and end events', () => {
        loadAndInit();
        expect(CallsNative.onVoIPTokenUpdated).toHaveBeenCalledTimes(1);
        expect(CallsNative.onCallAnswered).toHaveBeenCalledTimes(1);
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

    it('stores non-beta-prefixed token when isBetaApp is false', async () => {
        // Override isBetaApp to false for this test only.
        let handler: ((e: VoIPTokenUpdated) => Promise<void>) | undefined;
        jest.isolateModules(() => {
            jest.doMock('@utils/general', () => {
                const actual = jest.requireActual('@utils/general');
                return {
                    ...actual,
                    isBetaApp: false,
                };
            });
            const CallsNativeInit = require('./calls_native').default;
            CallsNativeInit.init();
            const mockedOnUpdated = CallsNative.onVoIPTokenUpdated as jest.Mock;
            const lastCall = mockedOnUpdated.mock.calls[mockedOnUpdated.mock.calls.length - 1];
            handler = lastCall?.[0];
        });
        await handler!({token: 'abc123'});
        expect(storeVoIPDeviceToken).toHaveBeenCalledWith(`${Device.PUSH_NOTIFY_APPLE_REACT_NATIVE}-v2:abc123`);
    });
});

describe('onCallAnswered', () => {
    it('closes the native call UI: there is nothing to join', () => {
        const {onCallAnswered} = loadAndInit();
        onCallAnswered({uuid: 'u1'});
        expect(CallsNative.reportEnded).toHaveBeenCalledWith('u1', 'failed');
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

    it('does nothing without a gomon call', () => {
        Object.defineProperty(Platform, 'OS', {get: () => 'android'});
        jest.mocked(getCurrentGomonCall).mockReturnValue(undefined);
        const emit = jest.spyOn(DeviceEventEmitter, 'emit');
        const {onCallEnded} = loadAndInit();
        onCallEnded({uuid: 'u1'});
        expect(emit).not.toHaveBeenCalledWith(GOMON_LEAVE);
    });
});
