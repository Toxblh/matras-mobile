// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: our own video-call service "gomon", served by the ru.corp.comms server plugin.
export const GOMON_PLUGIN_ID = 'ru.corp.comms';
export const GOMON_POST_TYPE = 'custom_comms_call';
export const GOMON_PUSH_SUB_TYPE = 'comms_call';

export const GOMON_EVENTS = {
    INCOMING: `custom_${GOMON_PLUGIN_ID}_incoming`,
    INCOMING_CLOSED: `custom_${GOMON_PLUGIN_ID}_incoming_closed`,
    CALL_STATE: `custom_${GOMON_PLUGIN_ID}_call_state`,
    MY_CALL: `custom_${GOMON_PLUGIN_ID}_my_call`,
};

// DeviceEventEmitter events inside the app.
export const GOMON_INCOMING_CLOSED = 'gomon_incoming_closed';
export const GOMON_LEAVE = 'gomon_leave';

export const LIVE_STATES = new Set(['STARTING', 'ACTIVE', 'EMPTY_GRACE']);
