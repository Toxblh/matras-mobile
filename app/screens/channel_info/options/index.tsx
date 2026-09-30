// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import {General} from '@constants';
import PlaybookRunsOption from '@playbooks/components/channel_actions/playbook_runs_option';
import {isTypeDMorGM} from '@utils/channel';

import AddMembers from './add_members';
import AutoFollowThreads from './auto_follow_threads';
import ChannelFiles from './channel_files';
import ChannelSettings from './channel_settings';
import IgnoreMentions from './ignore_mentions';
import Members from './members';
import MyAutotranslation from './my_autotranslation';
import NotificationPreference from './notification_preference';
import PinnedMessages from './pinned_messages';
import ResetChannelPosts from './reset_channel_posts';

type Props = {
    channelId: string;
    type?: ChannelType;
    canManageMembers: boolean;
    isCRTEnabled: boolean;
    isPlaybooksEnabled: boolean;
    hasChannelSettingsActions: boolean;
    isAutotranslationEnabledForThisChannel: boolean;
    channelDisplayName: string;
}

const Options = ({
    channelId,
    type,
    canManageMembers,
    isCRTEnabled,
    isPlaybooksEnabled,
    hasChannelSettingsActions,
    isAutotranslationEnabledForThisChannel,
    channelDisplayName,
}: Props) => {
    const isDMorGM = isTypeDMorGM(type);

    return (
        <>
            {hasChannelSettingsActions && (
                <ChannelSettings
                    channelId={channelId}
                    channelDisplayName={channelDisplayName}
                />
            )}
            {type !== General.DM_CHANNEL && (
                <>
                    {isCRTEnabled && (
                        <AutoFollowThreads channelId={channelId}/>
                    )}
                    <IgnoreMentions channelId={channelId}/>
                </>
            )}
            <NotificationPreference channelId={channelId}/>
            {isAutotranslationEnabledForThisChannel && (
                <MyAutotranslation channelId={channelId}/>
            )}
            <PinnedMessages channelId={channelId}/>
            <ChannelFiles channelId={channelId}/>
            {isPlaybooksEnabled && !isDMorGM &&
            <PlaybookRunsOption
                channelId={channelId}
                location='channel_actions'
            />
            }
            {type !== General.DM_CHANNEL &&
                <Members channelId={channelId}/>
            }
            {canManageMembers &&
                <AddMembers channelId={channelId}/>
            }
            <ResetChannelPosts channelId={channelId}/>
        </>
    );
};

export default Options;
