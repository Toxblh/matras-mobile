// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {withDatabase, withObservables} from '@nozbe/watermelondb/react';
import {combineLatest, of as of$, switchMap} from 'rxjs';

import {Preferences} from '@constants';
import {observeCurrentChannel} from '@queries/servers/channel';
import {observeHasGMasDMFeature} from '@queries/servers/features';
import {queryPreferencesByCategoryAndName} from '@queries/servers/preference';
import {observeScheduledPostCountForChannel} from '@queries/servers/scheduled_post';
import {
    observeCurrentChannelId,
    observeCurrentUserId,
} from '@queries/servers/system';
import {observeIsCRTEnabled} from '@queries/servers/thread';
import {observeChannelBannerIncluded} from '@screens/channel/channel_feature_checks';

import Channel from './channel';

import type {WithDatabaseArgs} from '@typings/database/database';

const enhanced = withObservables([], ({database}: WithDatabaseArgs) => {
    const channelId = observeCurrentChannelId(database);
    const dismissedGMasDMNotice = queryPreferencesByCategoryAndName(database, Preferences.CATEGORIES.SYSTEM_NOTICE, Preferences.NOTICES.GM_AS_DM).observe();
    const channelType = observeCurrentChannel(database).pipe(switchMap((c) => of$(c?.type)));
    const currentUserId = observeCurrentUserId(database);
    const hasGMasDMFeature = observeHasGMasDMFeature(database);
    const includeChannelBanner = observeChannelBannerIncluded(database, channelType, channelId);

    const isCRTEnabled = observeIsCRTEnabled(database);

    const scheduledPostCount = combineLatest([channelId, isCRTEnabled]).pipe(
        switchMap(([cid, isCRT]) => observeScheduledPostCountForChannel(database, cid, isCRT)),
    );

    return {
        channelId,
        dismissedGMasDMNotice,
        channelType,
        currentUserId,
        hasGMasDMFeature,
        includeChannelBanner,
        scheduledPostCount,
    };
});

export default withDatabase(enhanced(Channel));
