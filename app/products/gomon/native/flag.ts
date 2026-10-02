// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {storeGlobal} from '@actions/app/global';
import {MM_TABLES} from '@constants/database';
import DatabaseManager from '@database/manager';

import type GlobalModel from '@typings/database/models/app/global';

// matras: gomon calls run natively (LiveKit SDK) by default; the WebView call stays as the
// fallback behind this app-wide flag, toggled by a long press on the call title. On iOS only the
// native call is a CallKit call (WKWebView owns its audio session and conflicts with CallKit).
const FLAG_ID = 'gomonNativeCalls';

const NATIVE_BY_DEFAULT = true;

let enabled: boolean | undefined;

export async function isGomonNativeEnabled() {
    if (enabled === undefined) {
        try {
            const {database} = DatabaseManager.getAppDatabaseAndOperator();
            const row = await database.get<GlobalModel>(MM_TABLES.APP.GLOBAL).find(FLAG_ID);
            enabled = typeof row.value === 'boolean' ? row.value : NATIVE_BY_DEFAULT;
        } catch {
            enabled = NATIVE_BY_DEFAULT;
        }
    }
    return enabled;
}

export async function toggleGomonNative() {
    enabled = !(await isGomonNativeEnabled());
    await storeGlobal(FLAG_ID, enabled);
    return enabled;
}
