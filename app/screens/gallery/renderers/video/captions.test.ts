// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {SelectedTrackType} from 'react-native-video';

import {getTranscriptionUri, hasCaptions} from './captions';

describe('hasCaptions', () => {
    it('checks for valid captions', () => {
        expect(hasCaptions({captions: [{title: 'test', language: 'en', file_id: '123'}]})).toBe(true);
        expect(hasCaptions({captions: [{title: 'test'}]})).toBe(false);
        expect(hasCaptions({captions: []})).toBe(false);
        expect(hasCaptions({})).toBe(false);
        expect(hasCaptions(undefined)).toBe(false);
    });
});

describe('getTranscriptionUri', () => {
    const serverUrl = 'https://example.com';

    it('returns empty track when no captions', () => {
        const result = getTranscriptionUri(serverUrl, {});
        expect(result.tracks).toBeUndefined();
        expect(result.selected).toEqual({type: SelectedTrackType.DISABLED, value: ''});
    });

    it('returns track info when captions exist', () => {
        const result = getTranscriptionUri(serverUrl, {captions: [{title: 'English', language: 'en', file_id: '123'}]});
        expect(result.tracks?.length).toBe(1);
        expect(result.selected).toEqual({type: SelectedTrackType.INDEX, value: 0});
    });
});
