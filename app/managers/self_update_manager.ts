// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: self-update of a sideloaded Android APK from the altlinux.space releases.
// Checks on start and every 6 h in foreground; downloads with a mandatory SHA-256 check
// (native), then hands the APK to PackageInstaller. Never installs during a call.

import {defineMessages} from 'react-intl';
import {Alert, AppState, DeviceEventEmitter, NativeModules, Platform} from 'react-native';
import {BehaviorSubject} from 'rxjs';

import {getCurrentGomonCall} from '@gomon/store';
import {getIntlShape} from '@utils/general';
import {logWarning} from '@utils/log';
import {isSideloaded, isUpdateFor, latestAndroidRelease, sha256For, type AvailableUpdate, type Release} from '@utils/self_update';

const RELEASES_URL = 'https://altlinux.space/api/v1/repos/saratovmost/matras-mobile/releases?limit=5';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;
const CALL_POLL_MS = 15 * 1000;
const PROGRESS_EVENT = 'MatrasSelfUpdateProgress';

type NativeInfo = {installer: string | null; packageName: string; buildSha: string; canInstall: boolean};
type NativeSelfUpdate = {
    getInfo: () => Promise<NativeInfo>;
    openInstallSettings: () => void;
    download: (url: string, sha256: string) => Promise<void>;
    install: () => Promise<void>;
};

const Native: NativeSelfUpdate | undefined = Platform.OS === 'android' ? NativeModules.MatrasSelfUpdate : undefined;

const messages = defineMessages({
    title: {id: 'matras.update.title', defaultMessage: 'A new version of Matras is available ({sha})'},
    noNotes: {id: 'matras.update.no_notes', defaultMessage: 'Version {version}'},
    update: {id: 'matras.update.update', defaultMessage: 'Update'},
    later: {id: 'matras.update.later', defaultMessage: 'Later'},
    afterCall: {id: 'matras.update.after_call', defaultMessage: 'The update will be installed when the call ends.'},
    permissionTitle: {id: 'matras.update.permission.title', defaultMessage: 'Allow installs from this source'},
    permissionBody: {id: 'matras.update.permission.body', defaultMessage: 'To update, allow Matras to install apps, then return to the app.'},
    permissionOpen: {id: 'matras.update.permission.open', defaultMessage: 'Open settings'},
    failedTitle: {id: 'matras.update.failed.title', defaultMessage: 'Could not update Matras'},
    checksum: {id: 'matras.update.checksum', defaultMessage: 'The downloaded file failed the checksum check. The update was cancelled.'},
    signature: {id: 'matras.update.signature', defaultMessage: 'The new version is signed with a different key than the installed app. Uninstall Matras and install the APK manually.'},
    upToDate: {id: 'matras.update.up_to_date', defaultMessage: 'You have the latest version of Matras.'},
    unavailable: {id: 'matras.update.unavailable', defaultMessage: 'Automatic updates are only available for a Matras APK installed outside an app store.'},
});

// Download progress 0..1 (-1: size unknown); undefined when idle. Shown by SelfUpdateProgress.
export const selfUpdateProgress = new BehaviorSubject<number | undefined>(undefined);

const inCall = () => Boolean(getCurrentGomonCall());

const waitUntilNoCall = () => new Promise<void>((resolve) => {
    if (!inCall()) {
        resolve();
        return;
    }
    const timer = setInterval(() => {
        if (!inCall()) {
            clearInterval(timer);
            resolve();
        }
    }, CALL_POLL_MS);
});

const waitForForeground = () => new Promise<void>((resolve) => {
    const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
            sub.remove();
            resolve();
        }
    });
});

let lastCheck = 0;
let busy = false;
let timer: ReturnType<typeof setInterval> | undefined;
const prompted = new Set<string>();

const getInfo = async () => {
    try {
        return await Native?.getInfo();
    } catch (e) {
        logWarning('self-update: getInfo', e);
        return undefined;
    }
};

export const isSelfUpdateSupported = async () => {
    const info = await getInfo();
    return Boolean(info?.buildSha && isSideloaded(info.installer, info.packageName));
};

const fetchUpdate = async (buildSha: string) => {
    const res = await fetch(RELEASES_URL, {headers: {Accept: 'application/json'}});
    if (!res.ok) {
        throw new Error(`releases: HTTP ${res.status}`);
    }
    const update = latestAndroidRelease(await res.json() as Release[]);
    return isUpdateFor(update, buildSha) ? update : undefined;
};

const fail = (message: string) => {
    const intl = getIntlShape();
    Alert.alert(intl.formatMessage(messages.failedTitle), message);
};

const install = async (update: AvailableUpdate) => {
    const intl = getIntlShape();
    const res = await fetch(update.sumsUrl);
    const sha256 = res.ok ? sha256For(await res.text(), update.apkName) : undefined;
    if (!sha256) {
        fail(intl.formatMessage(messages.checksum));
        return;
    }

    const sub = DeviceEventEmitter.addListener(PROGRESS_EVENT, ({received, total}: {received: number; total: number}) => {
        selfUpdateProgress.next(total > 0 ? received / total : -1);
    });
    selfUpdateProgress.next(0);
    try {
        await Native!.download(update.apkUrl, sha256);
    } finally {
        sub.remove();
        selfUpdateProgress.next(undefined);
    }

    if (inCall()) {
        Alert.alert(intl.formatMessage(messages.title, {sha: update.sha}), intl.formatMessage(messages.afterCall));
        await waitUntilNoCall();
    }

    // The permission may be revoked while downloading; ask right before installing.
    const info = await getInfo();
    if (info && !info.canInstall) {
        const allowed = await new Promise<boolean>((resolve) => {
            Alert.alert(
                intl.formatMessage(messages.permissionTitle),
                intl.formatMessage(messages.permissionBody),
                [
                    {text: intl.formatMessage(messages.later), style: 'cancel', onPress: () => resolve(false)},
                    {
                        text: intl.formatMessage(messages.permissionOpen),
                        onPress: () => {
                            Native!.openInstallSettings();
                            waitForForeground().then(() => resolve(true));
                        },
                    },
                ],
                {cancelable: true, onDismiss: () => resolve(false)},
            );
        });
        if (!allowed || !(await getInfo())?.canInstall) {
            return;
        }
    }

    await Native!.install();
};

const startUpdate = async (update: AvailableUpdate) => {
    if (busy) {
        return;
    }
    busy = true;
    const intl = getIntlShape();
    try {
        await install(update);
    } catch (e) {
        const code = (e as {code?: string}).code;
        if (code === 'aborted') {
            return;
        }
        if (code === 'checksum') {
            fail(intl.formatMessage(messages.checksum));
        } else if (code === 'signature') {
            fail(intl.formatMessage(messages.signature));
        } else {
            fail((e as Error).message || String(e));
        }
    } finally {
        busy = false;
    }
};

export const checkForUpdates = async (manual = false) => {
    if (!Native || busy) {
        return;
    }
    const intl = getIntlShape();
    const info = await getInfo();
    if (!info?.buildSha || !isSideloaded(info.installer, info.packageName)) {
        if (manual) {
            Alert.alert(intl.formatMessage(messages.unavailable));
        }
        return;
    }

    lastCheck = Date.now();
    let update: AvailableUpdate | undefined;
    try {
        update = await fetchUpdate(info.buildSha);
    } catch (e) {
        logWarning('self-update: check', e);
        if (manual) {
            fail((e as Error).message);
        }
        return;
    }
    if (!update) {
        if (manual) {
            Alert.alert(intl.formatMessage(messages.upToDate));
        }
        return;
    }

    // Automatic checks ask once per release; the user can always check by hand.
    if (!manual && prompted.has(update.sha)) {
        return;
    }
    prompted.add(update.sha);
    const found = update;
    Alert.alert(
        intl.formatMessage(messages.title, {sha: found.sha}),
        found.notes || intl.formatMessage(messages.noNotes, {version: found.version}),
        [
            {text: intl.formatMessage(messages.later), style: 'cancel'},
            {text: intl.formatMessage(messages.update), onPress: () => startUpdate(found)},
        ],
    );
};

const tick = () => {
    if (AppState.currentState === 'active' && Date.now() - lastCheck >= CHECK_INTERVAL_MS) {
        checkForUpdates();
    }
};

export const initSelfUpdate = () => {
    if (!Native || timer) {
        return;
    }
    tick();
    timer = setInterval(tick, TICK_MS);
    AppState.addEventListener('change', (state) => state === 'active' && tick());
};
