// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {withDatabase, withObservables} from '@nozbe/watermelondb/react';
import {combineLatest, of as of$} from 'rxjs';
import {distinctUntilChanged, map, switchMap, combineLatestWith} from 'rxjs/operators';

import {General, Permissions} from '@constants';
import {observeChannel} from '@queries/servers/channel';
import {observePermissionForChannel, observePermissionForTeam, observeCanManageChannelSettings, observeCanManageChannelAutotranslations, observeCanManageSharedChannel} from '@queries/servers/role';
import {
    observeConfigValue,
    observeConfigBooleanValue,
} from '@queries/servers/system';
import {observeCurrentTeam} from '@queries/servers/team';
import {observeCurrentUser} from '@queries/servers/user';
import {isDefaultChannel} from '@utils/channel';
import {isMinimumServerVersion} from '@utils/helpers';

import ChannelSettings from './channel_settings';

import type {WithDatabaseArgs} from '@typings/database/database';

type Props = WithDatabaseArgs & {
    channelId: string;
}

const enhanced = withObservables(['channelId'], ({channelId, database}: Props) => {
    const channel = observeChannel(database, channelId);
    const type = channel.pipe(switchMap((c) => of$(c?.type)));
    const currentUser = observeCurrentUser(database);
    const team = observeCurrentTeam(database);
    const serverVersion = observeConfigValue(database, 'Version');

    const canManageSettings = currentUser.pipe(
        switchMap((u) => (u ? observeCanManageChannelSettings(database, channelId, u) : of$(false))),
        distinctUntilChanged(),
    );

    // canConvert observable (for Convert to private)
    const canConvert = channel.pipe(
        combineLatestWith(currentUser),
        switchMap(([ch, u]) => {
            if (!ch || !u || isDefaultChannel(ch)) {
                return of$(false);
            }
            if (ch.type !== General.OPEN_CHANNEL) {
                return of$(false);
            }
            return observePermissionForChannel(database, ch, u, Permissions.CONVERT_PUBLIC_CHANNEL_TO_PRIVATE, false);
        }),
    );

    // Archive observables
    const isArchived = channel.pipe(switchMap((c) => of$((c?.deleteAt || 0) > 0)));
    const canLeave = channel.pipe(
        combineLatestWith(currentUser),
        switchMap(([ch, u]) => {
            const isDC = isDefaultChannel(ch);
            return of$(!isDC || (isDC && u?.isGuest));
        }),
    );

    const canArchive = channel.pipe(
        combineLatestWith(currentUser, canLeave, isArchived, type),
        switchMap(([ch, u, leave, archived, chType]) => {
            if (
                chType === General.DM_CHANNEL || chType === General.GM_CHANNEL ||
                !ch || !u || !leave || archived
            ) {
                return of$(false);
            }

            if (chType === General.OPEN_CHANNEL) {
                return observePermissionForChannel(database, ch, u, Permissions.DELETE_PUBLIC_CHANNEL, true);
            }

            return observePermissionForChannel(database, ch, u, Permissions.DELETE_PRIVATE_CHANNEL, true);
        }),
    );

    const canUnarchive = team.pipe(
        combineLatestWith(currentUser, isArchived, type),
        switchMap(([t, u, archived, chType]) => {
            if (
                chType === General.DM_CHANNEL || chType === General.GM_CHANNEL ||
                !t || !u || !archived
            ) {
                return of$(false);
            }

            return observePermissionForTeam(database, t, u, Permissions.MANAGE_TEAM, false);
        }),
    );

    // Convert GM to channel observable
    const isGuestUser = currentUser.pipe(
        switchMap((u) => (u ? of$(u.isGuest) : of$(false))),
        distinctUntilChanged(),
    );

    const isConvertGMFeatureAvailable = serverVersion.pipe(
        switchMap((version) => of$(isMinimumServerVersion(version || '', 9, 1))),
    );

    const convertGMOptionAvailable = combineLatest([isConvertGMFeatureAvailable, type, isGuestUser]).pipe(
        switchMap(([available, chType, guest]) => of$(available && chType === General.GM_CHANNEL && !guest)),
    );

    // Channel autotranslation observable
    const canManageAutotranslations = currentUser.pipe(
        switchMap((u) => (u ? observeCanManageChannelAutotranslations(database, channelId, u) : of$(false))),
    );

    // Shared channels (connected workspaces)
    const sharedChannelsEnabled = observeConfigBooleanValue(database, 'ExperimentalSharedChannels');
    const canManageSharedChannelPermission = currentUser.pipe(
        switchMap((u) => (u ? observeCanManageSharedChannel(database, channelId, u) : of$(false))),
    );
    const canManageSharedChannel = combineLatest([canManageSharedChannelPermission, sharedChannelsEnabled]).pipe(
        map(([canManage, enabled]) => canManage && enabled),
    );

    return {
        canArchive,
        canConvert,
        canManageSettings,
        canUnarchive,
        convertGMOptionAvailable,
        displayName: channel.pipe(switchMap((c) => of$(c?.displayName || ''))),
        canManageAutotranslations,
        canManageSharedChannel,
        isGuestUser,
        type,
    };
});

export default withDatabase(enhanced(ChannelSettings));

