// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getCurrentGomonCall, setCurrentGomonCall, setGomonMinimized} from './store';

describe('gomon current call', () => {
    it('minimizes and expands only an active call', () => {
        setGomonMinimized(true);
        expect(getCurrentGomonCall()).toBeUndefined();

        const call = {serverUrl: 's', channelId: 'c', url: 'u', withCamera: false, locale: 'en', title: 't', startedAt: 1, minimized: false};
        setCurrentGomonCall(call);
        setGomonMinimized(false);
        expect(getCurrentGomonCall()).toBe(call);

        setGomonMinimized(true);
        expect(getCurrentGomonCall()).toEqual({...call, minimized: true});

        setCurrentGomonCall(undefined);
        expect(getCurrentGomonCall()).toBeUndefined();
    });
});
