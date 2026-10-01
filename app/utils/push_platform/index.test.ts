// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {pushPlatformPrefix} from '.';

describe('pushPlatformPrefix', () => {
    it('derives the prefix from the platform and the app id', () => {
        expect(pushPlatformPrefix('ios', 'ru.toxblh.matras')).toBe('apple_matras');
        expect(pushPlatformPrefix('ios', 'com.mattermost.rnbeta')).toBe('apple_rnbeta');
        expect(pushPlatformPrefix('ios', 'com.mattermost.rn')).toBe('apple_rn');
        expect(pushPlatformPrefix('ios', null)).toBe('apple_rn');
        expect(pushPlatformPrefix('android', 'ru.toxblh.matras')).toBe('android_rn');
    });
});
