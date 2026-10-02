// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: moved here from the removed Calls product; recordings posted by the Calls
// plugin still carry `captions` in their props.

import {SelectedTrackType, TextTrackType, type ISO639_1, type SelectedTrack, type TextTracks} from 'react-native-video';

import {buildFileUrl} from '@actions/remote/file';
import {isArrayOf} from '@utils/types';

import type {Caption} from '@typings/screens/gallery';

const isCaption = (obj: unknown): obj is Caption => {
    const c = obj as Caption | null;
    return typeof c === 'object' && c !== null && typeof c.title === 'string' && typeof c.language === 'string' && typeof c.file_id === 'string';
};

export const hasCaptions = (postProps?: Record<string, unknown>): boolean => {
    return Boolean(isArrayOf<Caption>(postProps?.captions, isCaption) && postProps.captions[0]);
};

export const getTranscriptionUri = (serverUrl: string, postProps?: Record<string, unknown>): {
    tracks?: TextTracks;
    selected: SelectedTrack;
} => {
    if (!isArrayOf<Caption>(postProps?.captions, isCaption) || !postProps.captions[0]) {
        return {
            tracks: undefined,
            selected: {type: SelectedTrackType.DISABLED, value: ''},
        };
    }

    const tracks: TextTracks = postProps.captions.map((t) => ({
        title: t.title,
        language: t.language as ISO639_1,
        type: TextTrackType.VTT,
        uri: buildFileUrl(serverUrl, t.file_id),
    }));

    return {
        tracks,
        selected: {type: SelectedTrackType.INDEX, value: 0},
    };
};
