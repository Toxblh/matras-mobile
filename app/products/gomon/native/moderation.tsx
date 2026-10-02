// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import Clipboard from '@react-native-clipboard/clipboard';
import React, {useState} from 'react';
import {useIntl} from 'react-intl';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

import {hapticFeedback} from '@utils/general';

import {messages} from './messages';
import {Sheet, SheetItem, sheetStyles} from './sheets';

import type {ApiError, Call, Connection, GomonApi} from './api';
import type {Conf} from './call_core';
import type {Room} from 'livekit-client';

const styles = StyleSheet.create({
    knock: {flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 8, marginBottom: 6, paddingLeft: 12, paddingRight: 6, paddingVertical: 6, borderRadius: 8, backgroundColor: '#2a3550'},
    knockText: {flex: 1, color: '#fff', fontSize: 13},
    link: {color: '#7aa7ff', fontSize: 14, paddingHorizontal: 16, paddingVertical: 4},
});

type Toast = (m: string) => void;

/** Runs a moderator command: errors become a toast (the server's text, in Russian by code). */
export async function run(f: () => Promise<unknown>, toast: Toast, done?: string) {
    try {
        await f();
        hapticFeedback();
        if (done) {
            toast(done);
        }
        return true;
    } catch (e) {
        toast((e as ApiError)?.message ?? String(e));
        return false;
    }
}

export const lobbyOf = (call: Call | null) => (call?.lobby ?? []).filter((a) => a.state === 'WAITING_LOBBY');

/** A guest knocks (moderators): the first one with Deny / Admit, as the web's knock bar. */
export const KnockBanner = ({api, call, toast, refresh}: {api: GomonApi | null; call: Call | null; toast: Toast; refresh: () => void}) => {
    const intl = useIntl();
    const lobby = lobbyOf(call);
    if (!api || !lobby.length) {
        return null;
    }
    const first = lobby[0];
    const act = (action: 'admit' | 'deny') => run(() => api.admission(first.admission_id, action), toast).finally(refresh);
    return (
        <View
            style={styles.knock}
            accessibilityRole='alert'
            testID='gomon_call.knock'
        >
            <Text style={styles.knockText}>{intl.formatMessage(messages.knocks, {name: first.display_name, more: lobby.length - 1})}</Text>
            <Pressable
                style={[sheetStyles.btn, sheetStyles.btnOff]}
                onPress={() => act('deny')}
                testID='gomon_call.knock.deny'
            >
                <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.deny)}</Text>
            </Pressable>
            <Pressable
                style={[sheetStyles.btn, call?.locked && sheetStyles.btnOff]}
                disabled={call?.locked}
                onPress={() => act('admit')}
                testID='gomon_call.knock.admit'
            >
                <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.admit)}</Text>
            </Pressable>
        </View>
    );
};

type ActionsProps = {
    target: Connection | null;
    onClose: () => void;
    api: GomonApi | null;
    call: Call | null;
    conf: Conf;
    room: Room;
    toast: Toast;
    refresh: () => void;
};

/** What a moderator can do with one participant (meeting-web's roster actions + conf tools). */
export const ParticipantActions = ({target, onClose, api, call, conf, room, toast, refresh}: ActionsProps) => {
    const intl = useIntl();
    if (!target || !api || !call) {
        return null;
    }
    const id = call.call_id;
    const lk = room.getParticipantByIdentity(target.connection_id);
    const micOn = Boolean(lk?.isMicrophoneEnabled);
    const isHost = Boolean(target.principal_id) && target.principal_id === call.host_id;
    const isCo = Boolean(target.principal_id && call.cohost_ids?.includes(target.principal_id));
    const hand = conf.hands.find((h) => h.connection_ids.includes(target.connection_id));
    const act = async (f: () => Promise<unknown>, done?: string) => {
        onClose();
        await run(f, toast, done);
        refresh();
    };
    const askRemove = () => {
        onClose();
        Alert.alert(intl.formatMessage(messages.removeAsk, {name: target.display_name}), undefined, [
            {text: intl.formatMessage(messages.cancel), style: 'cancel'},
            {text: intl.formatMessage(messages.removeOne), style: 'destructive', onPress: () => run(() => api.remove(id, target.connection_id), toast).finally(refresh)},
        ]);
    };
    return (
        <Sheet
            visible={true}
            onClose={onClose}
            title={target.display_name}
            testID='gomon_call.participant_actions'
        >
            {conf.can.mute_other && micOn &&
                <SheetItem
                    icon='microphone-off'
                    text={intl.formatMessage(messages.muteOther)}
                    onPress={() => act(() => api.mute(id, target.connection_id))}
                    testID='gomon_call.participant.mute'
                />
            }
            {conf.can.request_unmute && !micOn && target.kind !== 'room' &&
                <SheetItem
                    icon='microphone'
                    text={intl.formatMessage(messages.askUnmute)}
                    onPress={() => act(() => api.requestUnmute(id, target.connection_id), intl.formatMessage(messages.askedUnmute, {name: target.display_name}))}
                    testID='gomon_call.participant.ask_unmute'
                />
            }
            {conf.can.lower_other_hand && hand &&
                <SheetItem
                    icon='hand-right-outline'
                    text={intl.formatMessage(messages.lowerHandOf)}
                    onPress={() => act(() => api.lowerHand(id, target.connection_id))}
                    testID='gomon_call.participant.lower_hand'
                />
            }
            {call.my_role === 'host' && target.kind === 'employee' && !isHost && !isCo &&
                <SheetItem
                    icon='crown-outline'
                    text={intl.formatMessage(messages.makeCohost)}
                    onPress={() => act(() => api.cohost(id, target.principal_id!))}
                    testID='gomon_call.participant.cohost'
                />
            }
            {!isHost &&
                <SheetItem
                    icon='account-minus-outline'
                    text={intl.formatMessage(messages.removeOne)}
                    onPress={askRemove}
                    danger={true}
                    testID='gomon_call.participant.remove'
                />
            }
        </Sheet>
    );
};

type AccessProps = {
    visible: boolean;
    onClose: () => void;
    api: GomonApi | null;
    call: Call | null;
    moderator: boolean;
    toast: Toast;
    refresh: () => void;
};

/** Meeting link, guest link (create / copy / revoke) and the lock: the web's "Guest link" panel. */
export const AccessSheet = ({visible, onClose, api, call, moderator, toast, refresh}: AccessProps) => {
    const intl = useIntl();

    // kept while the call lasts so that a reopened sheet still offers to revoke the link
    const [link, setLink] = useState<{id: string; url: string} | null>(null);
    const copy = (text: string) => {
        Clipboard.setString(text);
        hapticFeedback();
        toast(intl.formatMessage(messages.copied));
    };
    if (!call || !api) {
        return null;
    }
    const make = () => run(async () => {
        const r = await api.guestLink(call.call_id);
        setLink({id: r.link_id, url: `${api.origin}/guest/${r.url_token}`});
    }, toast);
    const revoke = () => run(async () => {
        await api.revokeLink(link!.id);
        setLink(null);
    }, toast, intl.formatMessage(messages.linkRevoked));
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(messages.access)}
            testID='gomon_call.access'
        >
            <ScrollView>
                {Boolean(call.meet_url) &&
                    <>
                        <Text style={sheetStyles.section}>{intl.formatMessage(messages.meetLink)}</Text>
                        <Text
                            style={styles.link}
                            selectable={true}
                            testID='gomon_call.access.meet_url'
                        >
                            {call.meet_url}
                        </Text>
                        <SheetItem
                            icon='content-copy'
                            text={intl.formatMessage(messages.copy)}
                            onPress={() => copy(call.meet_url!)}
                            testID='gomon_call.access.copy_meet'
                        />
                    </>
                }
                <Text style={sheetStyles.section}>{intl.formatMessage(messages.guestLink)}</Text>
                <Text style={sheetStyles.hint}>{intl.formatMessage(messages.guestLinkHint)}</Text>
                {link ? (
                    <>
                        <Text
                            style={styles.link}
                            selectable={true}
                            testID='gomon_call.access.guest_url'
                        >
                            {link.url}
                        </Text>
                        <SheetItem
                            icon='content-copy'
                            text={intl.formatMessage(messages.copy)}
                            onPress={() => copy(link.url)}
                            testID='gomon_call.access.copy_guest'
                        />
                        <SheetItem
                            icon='link-variant-off'
                            text={intl.formatMessage(messages.revokeLink)}
                            onPress={revoke}
                            danger={true}
                            testID='gomon_call.access.revoke'
                        />
                    </>
                ) : (
                    <SheetItem
                        icon='link-variant'
                        text={intl.formatMessage(messages.guestLinkMake)}
                        onPress={moderator ? make : () => undefined}
                        testID='gomon_call.access.make_guest'
                    />
                )}
                {moderator &&
                    <SheetItem
                        icon={call.locked ? 'lock-outline' : 'lock'}
                        text={intl.formatMessage(call.locked ? messages.unlock : messages.lock)}
                        sub={call.locked ? intl.formatMessage(messages.locked) : undefined}
                        onPress={() => run(() => api.lock(call.call_id, !call.locked), toast).finally(refresh)}
                        testID='gomon_call.access.lock'
                    />
                }
            </ScrollView>
        </Sheet>
    );
};
