// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {isSideloaded, isUpdateFor, latestAndroidRelease, parseReleaseTag, sameCommit, sha256For, type Release} from './self_update';

const PKG = 'com.mattermost.rnbeta';
const HASH = 'a'.repeat(64);

const release = (tag: string, assets = ['matras-2.44.0-2a2740b5.apk', 'SHA256SUMS']): Release => ({
    tag_name: tag,
    body: ' notes \n',
    assets: assets.map((name) => ({name, browser_download_url: `https://x/${name}`})),
});

describe('self update helpers', () => {
    it('classifies installers', () => {
        expect(isSideloaded(null, PKG)).toBe(true);
        expect(isSideloaded('', PKG)).toBe(true);
        expect(isSideloaded(PKG, PKG)).toBe(true);
        expect(isSideloaded('com.google.android.packageinstaller', PKG)).toBe(true);
        expect(isSideloaded('com.android.packageinstaller', PKG)).toBe(true);
        expect(isSideloaded('com.android.shell', PKG)).toBe(true);
        expect(isSideloaded('com.samsung.android.packageinstaller', PKG)).toBe(true);
        expect(isSideloaded('com.android.vending', PKG)).toBe(false);
        expect(isSideloaded('ru.vk.store', PKG)).toBe(false);
        expect(isSideloaded('com.sec.android.app.samsungapps', PKG)).toBe(false);
        expect(isSideloaded('org.fdroid.fdroid', PKG)).toBe(false);
    });

    it('parses release tags', () => {
        expect(parseReleaseTag('android-2.44.0-2a2740b5')).toEqual({version: '2.44.0', sha: '2a2740b5'});
        expect(parseReleaseTag('android-2.44.0-rc1-ABCDEF12')).toEqual({version: '2.44.0-rc1', sha: 'abcdef12'});
        expect(parseReleaseTag('v2.44.0')).toBeUndefined();
        expect(parseReleaseTag('desktop-6.3.0-2a2740b5')).toBeUndefined();
    });

    it('compares commits by prefix', () => {
        expect(sameCommit('2a2740b5', '2a2740b5e5df34e2')).toBe(true);
        expect(sameCommit('2A2740B5', '2a2740b5')).toBe(true);
        expect(sameCommit('2a2740b5', 'cd00ac73')).toBe(false);
        expect(sameCommit('', '2a2740b5')).toBe(false);
    });

    it('takes only the newest complete android release', () => {
        const update = latestAndroidRelease([release('ios-1-2a2740b5'), release('android-2.44.0-2a2740b5'), release('android-2.44.0-cd00ac73')]);
        expect(update).toEqual({
            tag: 'android-2.44.0-2a2740b5',
            version: '2.44.0',
            sha: '2a2740b5',
            notes: 'notes',
            apkName: 'matras-2.44.0-2a2740b5.apk',
            apkUrl: 'https://x/matras-2.44.0-2a2740b5.apk',
            sumsUrl: 'https://x/SHA256SUMS',
        });

        // assets of the newest still uploading: no fallback to an older release
        expect(latestAndroidRelease([release('android-2.44.0-2a2740b5', ['a.apk']), release('android-2.44.0-cd00ac73')])).toBeUndefined();
        expect(latestAndroidRelease([{...release('android-2.44.0-2a2740b5'), draft: true}])).toBeUndefined();
        expect(latestAndroidRelease([])).toBeUndefined();
    });

    it('offers an update only for another commit of a CI build', () => {
        const update = latestAndroidRelease([release('android-2.44.0-2a2740b5')]);
        expect(isUpdateFor(update, 'cd00ac73')).toBe(true);
        expect(isUpdateFor(update, '2a2740b5')).toBe(false);
        expect(isUpdateFor(update, '')).toBe(false);
        expect(isUpdateFor(undefined, 'cd00ac73')).toBe(false);
    });

    it('reads SHA256SUMS', () => {
        const sums = `${HASH}  matras-2.44.0-2a2740b5.apk\n${'b'.repeat(64)} *other.apk\n`;
        expect(sha256For(sums, 'matras-2.44.0-2a2740b5.apk')).toBe(HASH);
        expect(sha256For(sums, 'other.apk')).toBe('b'.repeat(64));
        expect(sha256For(sums, 'missing.apk')).toBeUndefined();
        expect(sha256For('nothex  a.apk', 'a.apk')).toBeUndefined();
    });
});
