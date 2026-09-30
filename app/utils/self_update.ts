// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: pure helpers of the Android self-update (see @managers/self_update_manager).

export type ReleaseAsset = {name: string; browser_download_url: string};
export type Release = {tag_name: string; body?: string; draft?: boolean; assets?: ReleaseAsset[]};

export type AvailableUpdate = {
    tag: string;
    version: string;
    sha: string;
    notes: string;
    apkName: string;
    apkUrl: string;
    sumsUrl: string;
};

const TAG_RE = /^android-(.+)-([0-9a-f]{7,40})$/i;

// Installers that mean "the user installed the APK by hand" (or we updated ourselves).
// Anything else (Play, RuStore, Galaxy Store, F-Droid, …) owns updates: no self-update.
const SIDELOAD_INSTALLERS = new Set([
    'com.google.android.packageinstaller',
    'com.android.packageinstaller',
    'com.android.shell',
    'adb',
]);

export const isSideloaded = (installer: string | null | undefined, ownPackage: string) => {
    if (!installer || installer === ownPackage || SIDELOAD_INSTALLERS.has(installer)) {
        return true;
    }

    // OEM system installers: com.samsung.android.packageinstaller, com.miui.packageinstaller, …
    return installer.endsWith('.packageinstaller');
};

export const parseReleaseTag = (tag: string) => {
    const m = TAG_RE.exec(tag);
    return m ? {version: m[1], sha: m[2].toLowerCase()} : undefined;
};

export const sameCommit = (a: string, b: string) => {
    const n = Math.min(a.length, b.length);
    return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase();
};

// Only the newest android release counts: falling back to an older one could downgrade.
// A release whose assets are still uploading (no APK or no SHA256SUMS yet) → nothing now.
export const latestAndroidRelease = (releases: Release[]): AvailableUpdate | undefined => {
    const release = releases.find((r) => !r.draft && parseReleaseTag(r.tag_name));
    if (!release) {
        return undefined;
    }
    const {version, sha} = parseReleaseTag(release.tag_name)!;
    const apk = release.assets?.find((a) => a.name.endsWith('.apk'));
    const sums = release.assets?.find((a) => a.name === 'SHA256SUMS');
    if (!apk || !sums) {
        return undefined;
    }
    return {
        tag: release.tag_name,
        version,
        sha,
        notes: release.body?.trim() ?? '',
        apkName: apk.name,
        apkUrl: apk.browser_download_url,
        sumsUrl: sums.browser_download_url,
    };
};

// An empty build sha (local/dev builds) never updates.
export const isUpdateFor = (update: AvailableUpdate | undefined, buildSha: string): update is AvailableUpdate => {
    return Boolean(update && buildSha && !sameCommit(update.sha, buildSha));
};

// `sha256sum` output: "<64 hex>  <name>" (or "<hex> *<name>" in binary mode).
export const sha256For = (sums: string, fileName: string) => {
    for (const line of sums.split('\n')) {
        const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
        if (m && m[2] === fileName) {
            return m[1].toLowerCase();
        }
    }
    return undefined;
};
