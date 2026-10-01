// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DeviceEventEmitter, type EmitterSubscription} from 'react-native';

import DatabaseManager from '@database/manager';
import {acceptGomonFromPush} from '@gomon/actions';
import {GOMON_LEAVE} from '@gomon/constants';
import {getCurrentGomonCall} from '@gomon/store';
import {getCurrentUser} from '@queries/servers/user';
import {getIntlShape} from '@utils/general';

import {TelecomEvents} from './android_platform';

let subs: EmitterSubscription[] = [];

/**
 * App-wide Telecom events (Android): the pushed ring answered from a car / Bluetooth headset
 * joins the call like the notification's Answer; the system ending the call leaves it.
 */
export function initGomonTelecom() {
    subs.forEach((s) => s.remove());
    subs = [
        DeviceEventEmitter.addListener(TelecomEvents.Answer, async ({serverUrl, channelId}: {serverUrl: string; channelId: string}) => {
            const database = DatabaseManager.serverDatabases[serverUrl]?.database;
            if (!database) {
                return;
            }
            const user = await getCurrentUser(database);
            await acceptGomonFromPush(getIntlShape(user?.locale), serverUrl, channelId);
        }),
        DeviceEventEmitter.addListener(TelecomEvents.Disconnect, () => {
            if (getCurrentGomonCall()) {
                DeviceEventEmitter.emit(GOMON_LEAVE);
            }
        }),
    ];
}
