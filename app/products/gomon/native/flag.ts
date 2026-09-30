// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {storeGlobal} from '@actions/app/global';
import {MM_TABLES} from '@constants/database';
import DatabaseManager from '@database/manager';

import type GlobalModel from '@typings/database/models/app/global';

// matras: native (LiveKit) gomon calls are a prototype behind this app-wide flag; the WebView
// call stays the default. Toggled by a long press on the call title.
const FLAG_ID = 'gomonNativeCalls';

let enabled: boolean | undefined;

export async function isGomonNativeEnabled() {
    if (enabled === undefined) {
        try {
            const {database} = DatabaseManager.getAppDatabaseAndOperator();
            const row = await database.get<GlobalModel>(MM_TABLES.APP.GLOBAL).find(FLAG_ID);
            enabled = row.value === true;
        } catch {
            enabled = false;
        }
    }
    return enabled;
}

export async function toggleGomonNative() {
    enabled = !(await isGomonNativeEnabled());
    await storeGlobal(FLAG_ID, enabled);
    return enabled;
}
