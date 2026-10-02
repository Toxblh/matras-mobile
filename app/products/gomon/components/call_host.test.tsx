// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import CallsNative from '@mattermost/calls-native';
import {act} from '@testing-library/react-native';
import React from 'react';

import {setCurrentGomonCall, setGomonMinimized, type CurrentGomonCall} from '@gomon/store';
import {renderWithIntl} from '@test/intl-test-helper';

import GomonCallHost from './call_host';

jest.mock('react-native-webview', () => ({__esModule: true, default: 'WebView'}));
jest.mock('@gomon/native', () => ({__esModule: true, default: 'GomonNativeCall'}));
jest.mock('@gomon/foreground_service', () => ({foregroundServiceStart: jest.fn(), foregroundServiceStop: jest.fn()}));

const call: CurrentGomonCall = {
    serverUrl: 'https://mm',
    channelId: 'ch',
    url: 'https://g/call/1?embed=rn#code=ab',
    withCamera: false,
    withMic: true,
    locale: 'en',
    title: 'Team',
    startedAt: 1,
    minimized: false,
};

describe('GomonCallHost', () => {
    afterEach(() => act(() => setCurrentGomonCall(undefined)));

    it('hosts the WebView call full screen, then as the floating bar', async () => {
        const {getByTestId, queryByTestId, UNSAFE_root} = renderWithIntl(<GomonCallHost/>);
        await act(async () => setCurrentGomonCall(call));
        expect(getByTestId('gomon_call.leave')).toBeTruthy();
        expect(UNSAFE_root.findByType('WebView' as never).props.source).toEqual({uri: call.url});
        expect(CallsNative.startAudioSession).toHaveBeenCalled();

        await act(async () => setGomonMinimized(true));
        expect(getByTestId('gomon_call.bar')).toBeTruthy();
        expect(queryByTestId('gomon_call.leave')).toBeNull();
        expect(UNSAFE_root.findByType('WebView' as never)).toBeTruthy();
    });

    it('hosts the native call when the call is native', async () => {
        const {UNSAFE_root} = renderWithIntl(<GomonCallHost/>);
        await act(async () => setCurrentGomonCall({...call, native: true}));
        expect(UNSAFE_root.findByType('GomonNativeCall' as never).props.call.native).toBe(true);
    });
});
