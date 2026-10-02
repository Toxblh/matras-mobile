// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {pickPipTile, videoViewOf} from './android_pip';

import type {TileInfo} from './stage';

const tile = (identity: string, opts: {local?: boolean; screen?: boolean; video?: boolean; muted?: boolean; speaking?: boolean} = {}) => ({
    key: `${identity}:${opts.screen ? 'screen' : 'camera'}`,
    p: {identity, isSpeaking: Boolean(opts.speaking)},
    pub: opts.video === false ? undefined : {track: {}, isMuted: Boolean(opts.muted)},
    screen: Boolean(opts.screen),
    local: Boolean(opts.local),
} as unknown as TileInfo);

describe('videoViewOf', () => {
    test('pip wins, otherwise visible only while active', () => {
        expect(videoViewOf(true, 'background')).toBe('pip');
        expect(videoViewOf(false, 'active')).toBe('full');
        expect(videoViewOf(false, 'background')).toBe('none');
        expect(videoViewOf(false, 'inactive')).toBe('none');
    });
});

describe('pickPipTile', () => {
    const me = tile('me', {local: true});
    test('remote screen share first, the latest one', () => {
        const tiles = [me, tile('a', {speaking: true}), tile('b', {screen: true}), tile('c', {screen: true})];
        expect(pickPipTile(tiles, 'a')?.key).toBe('c:screen');
    });
    test('our own screen share is never the PiP', () => {
        expect(pickPipTile([me, tile('me', {local: true, screen: true}), tile('a')], null)?.key).toBe('a:camera');
    });
    test('speaking, then last speaker, then any remote video', () => {
        expect(pickPipTile([me, tile('a'), tile('b', {speaking: true})], 'a')?.key).toBe('b:camera');
        expect(pickPipTile([me, tile('a'), tile('b')], 'b')?.key).toBe('b:camera');
        expect(pickPipTile([me, tile('a', {muted: true}), tile('b')], 'a')?.key).toBe('b:camera');
    });
    test('falls back to our camera, or nothing without video', () => {
        expect(pickPipTile([me, tile('a', {video: false})], 'a')?.key).toBe('me:camera');
        expect(pickPipTile([tile('me', {local: true, video: false})], null)).toBeUndefined();
    });
});
