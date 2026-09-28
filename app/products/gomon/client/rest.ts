// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {GOMON_PLUGIN_ID} from '@gomon/constants';

export type GomonCallView = {
    call_id: string;
    channel_id: string;
    state: string;
    card_post_id?: string;
    participants?: number;
    participant_names?: string;
    participant_ids?: string;
    started_at?: number;
    in_call?: boolean;
};

export interface ClientGomonMix {
    gomonStartCall: (channelId: string, video: boolean) => Promise<{call_id: string; reused: boolean; join_url: string}>;
    gomonJoinCall: (callId: string) => Promise<{join_url: string}>;
    gomonGetChannelCall: (channelId: string) => Promise<{call: GomonCallView | null}>;
    gomonInvitation: (invitationId: string, action: 'ack' | 'accept' | 'decline') => Promise<{state: string; join_url?: string}>;
    gomonChannelInvitation: (channelId: string, action: 'accept' | 'decline') => Promise<{state?: string; join_url?: string}>;
}

const ClientGomon = (superclass: any) => class extends superclass {
    getGomonRoute() {
        return `${this.getPluginRoute(GOMON_PLUGIN_ID)}/api/v1`;
    }

    gomonStartCall = async (channelId: string, video: boolean) => {
        return this.doFetch(`${this.getGomonRoute()}/calls`, {method: 'post', body: {channel_id: channelId, video}});
    };

    gomonJoinCall = async (callId: string) => {
        return this.doFetch(`${this.getGomonRoute()}/join/${callId}`, {method: 'post'});
    };

    gomonGetChannelCall = async (channelId: string) => {
        return this.doFetch(`${this.getGomonRoute()}/channels/${channelId}/call`, {method: 'get'});
    };

    gomonInvitation = async (invitationId: string, action: string) => {
        return this.doFetch(`${this.getGomonRoute()}/invitations/${invitationId}/${action}`, {method: 'post'});
    };

    gomonChannelInvitation = async (channelId: string, action: string) => {
        return this.doFetch(`${this.getGomonRoute()}/channels/${channelId}/${action}`, {method: 'post'});
    };
};

export default ClientGomon;
