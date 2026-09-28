// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {bridgeCommand, buildEmbedUrl, isGomonPluginEnabled, isLiveState, parseBridgeMessage, urlOrigin} from './utils';

describe('gomon utils', () => {
    it('inserts embed=rn before the fragment', () => {
        expect(buildEmbedUrl('https://g.example/call/abc#code=ff')).toBe('https://g.example/call/abc?embed=rn#code=ff');
        expect(buildEmbedUrl('https://g.example/call/abc#code=ff', true)).toBe('https://g.example/call/abc?embed=rn&cam=0#code=ff');
        expect(buildEmbedUrl('https://g.example/call/abc?x=1#code=ff')).toBe('https://g.example/call/abc?x=1&embed=rn#code=ff');
        expect(buildEmbedUrl('https://g.example/call/abc')).toBe('https://g.example/call/abc?embed=rn');
    });

    it('extracts the origin', () => {
        expect(urlOrigin('https://G.example/call/abc?embed=rn#code=1')).toBe('https://g.example');
        expect(urlOrigin('https://g.example:8443')).toBe('https://g.example:8443');
        expect(urlOrigin('about:blank')).toBe('');
    });

    it('parses bridge messages', () => {
        expect(parseBridgeMessage('{"type":"comms:ready"}')).toEqual({type: 'comms:ready'});
        expect(parseBridgeMessage('{"type":"comms:state","mic":true,"cam":0,"people":"3"}')).toEqual({type: 'comms:state', mic: true, cam: false, people: 3});
        expect(parseBridgeMessage('{"type":"comms:ended","reason":"left"}')).toEqual({type: 'comms:ended', reason: 'left'});
        expect(parseBridgeMessage('{"type":"other"}')).toBeUndefined();
        expect(parseBridgeMessage('not json')).toBeUndefined();
        expect(parseBridgeMessage('null')).toBeUndefined();
    });

    it('builds the command script with a plain string detail', () => {
        expect(bridgeCommand('mic')).toBe('window.dispatchEvent(new CustomEvent("comms:command",{detail:"mic"}));true;');
    });

    it('detects the plugin and live states', () => {
        expect(isGomonPluginEnabled([{id: 'playbooks'}, {id: 'ru.corp.comms'}])).toBe(true);
        expect(isGomonPluginEnabled([{id: 'playbooks'}])).toBe(false);
        expect(isGomonPluginEnabled(undefined)).toBe(false);
        expect(isLiveState('EMPTY_GRACE')).toBe(true);
        expect(isLiveState('ENDED')).toBe(false);
    });
});
