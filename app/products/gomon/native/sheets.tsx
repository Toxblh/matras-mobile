// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from 'react';
import {useIntl} from 'react-intl';
import {FlatList, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CompassIcon from '@components/compass_icon';
import {useKeyboardHeight} from '@hooks/device';
import FilePickerUtil from '@utils/file/file_picker';
import {hapticFeedback} from '@utils/general';
import {logDebug} from '@utils/log';
import {tryOpenURL} from '@utils/url';

import {chatError, confOf, fmtSize, type ChatFile, type ChatMessage, type ChatStore} from './call_core';
import {messages} from './messages';
import {lobbyOf, ParticipantActions, run} from './moderation';
import {Avatar} from './stage';

import type {ApiError, Call, Connection, GomonApi, LocalFile, UserRef} from './api';
import type {Room} from 'livekit-client';

export const BG = '#1f2228';
export const MUTED = 'rgba(255,255,255,0.64)';

export const sheetStyles = StyleSheet.create({
    backdrop: {flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)'},
    sheet: {borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: BG, maxHeight: '85%', width: '100%', maxWidth: 640, alignSelf: 'center'},
    tall: {height: '85%'},
    head: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12},
    title: {flex: 1, color: '#fff', fontSize: 17, fontWeight: '600'},
    section: {color: MUTED, fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4},
    row: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 12},
    grow: {flex: 1},
    name: {color: '#fff', fontSize: 15},
    sub: {color: MUTED, fontSize: 12, marginTop: 2},
    item: {flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 14},
    itemText: {color: '#fff', fontSize: 16},
    msg: {paddingHorizontal: 16, paddingVertical: 6},
    msgHead: {flexDirection: 'row', alignItems: 'center', gap: 6},
    msgName: {color: '#fff', fontSize: 13, fontWeight: '600'},
    msgTag: {color: MUTED, fontSize: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 4, paddingHorizontal: 4},
    msgTime: {color: MUTED, fontSize: 11},
    msgText: {color: '#fff', fontSize: 15, marginTop: 2},
    msgLink: {color: '#7aa7ff', fontSize: 15, marginTop: 2, textDecorationLine: 'underline'},
    msgDeleted: {color: MUTED, fontStyle: 'italic', fontSize: 14, marginTop: 2},
    empty: {color: MUTED, fontSize: 14, textAlign: 'center', padding: 24},
    composer: {flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)'},
    input: {flex: 1, color: '#fff', fontSize: 15, maxHeight: 120, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)'},
    send: {padding: 8},
    error: {color: '#ff6b6b', fontSize: 13, paddingHorizontal: 16, paddingBottom: 4},
    search: {color: '#fff', fontSize: 15, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)'},
    btn: {paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1c58d9'},
    btnOff: {backgroundColor: 'rgba(255,255,255,0.12)'},
    btnText: {color: '#fff', fontSize: 13, fontWeight: '600'},
    btnDanger: {backgroundColor: '#d24b4e'},
    itemDanger: {color: '#ff6b6b'},
    itemSub: {color: MUTED, fontSize: 12, marginTop: 2},
    badge: {minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: '#c58c1c', alignItems: 'center', justifyContent: 'center'},
    badgeText: {color: '#fff', fontSize: 12, fontWeight: '700'},
    text: {color: '#fff', fontSize: 15, paddingHorizontal: 16, paddingVertical: 4},
    hint: {color: MUTED, fontSize: 13, paddingHorizontal: 16, paddingVertical: 4},
    actions: {flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 16, paddingVertical: 12},
    big: {paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8},
    chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8},
    chip: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)'},
    chipOn: {backgroundColor: '#1c58d9', borderColor: '#1c58d9'},
    chipText: {color: '#fff', fontSize: 14},
    field: {color: '#fff', fontSize: 15, marginHorizontal: 16, marginVertical: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)'},
    radio: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10},
    file: {marginTop: 4, borderRadius: 8, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.06)', maxWidth: 320},
    thumb: {width: '100%', height: 160},
    fileRow: {flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8},
    pending: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6},
});
const styles = sheetStyles;

/** A bottom sheet as a plain Modal: the call sits above navigation (see audio_output_button). */
export const Sheet = ({visible, title, onClose, tall, children, testID}: {visible: boolean; title?: string; onClose: () => void; tall?: boolean; children: ReactNode; testID?: string}) => {
    const intl = useIntl();
    const insets = useSafeAreaInsets();
    const keyboardHeight = useKeyboardHeight();
    const win = useWindowDimensions();

    // Edge-to-edge Android reports the keyboard without the navigation bar under it.
    const keyboard = keyboardHeight && Platform.OS === 'android' ? keyboardHeight + insets.bottom : keyboardHeight;
    return (
        <Modal
            transparent={true}
            visible={visible}
            animationType='slide'
            onRequestClose={onClose}
            statusBarTranslucent={true}
            navigationBarTranslucent={true}
            supportedOrientations={['portrait', 'landscape']}
        >
            <Pressable
                style={styles.backdrop}
                onPress={onClose}
            >
                <Pressable
                    style={[styles.sheet, tall && (keyboard ? {height: win.height - keyboard - insets.top - 48} : styles.tall), {marginBottom: keyboard, paddingBottom: keyboard ? 8 : insets.bottom + 8}]}
                    testID={testID}
                >
                    {title !== undefined &&
                    <View style={styles.head}>
                        <Text style={styles.title}>{title}</Text>
                        <Pressable
                            onPress={onClose}
                            accessibilityLabel={intl.formatMessage(messages.close)}
                            testID='gomon_call.sheet.close'
                        >
                            <CompassIcon
                                name='close'
                                size={22}
                                color='#fff'
                            />
                        </Pressable>
                    </View>
                    }
                    {children}
                </Pressable>
            </Pressable>
        </Modal>
    );
};

type SheetItemProps = {
    icon: React.ComponentProps<typeof CompassIcon>['name'];
    text: string;
    onPress: () => void;
    testID?: string;
    sub?: string;
    danger?: boolean;
    badge?: string;
};
export const SheetItem = ({icon, text, onPress, testID, sub, danger, badge}: SheetItemProps) => (
    <Pressable
        style={styles.item}
        onPress={onPress}
        testID={testID}
        accessibilityRole='button'
        accessibilityLabel={badge ? `${text}, ${badge}` : text}
    >
        <CompassIcon
            name={icon}
            size={22}
            color={danger ? '#ff6b6b' : '#fff'}
        />
        <View style={styles.grow}>
            <Text style={[styles.itemText, danger && styles.itemDanger]}>{text}</Text>
            {Boolean(sub) && <Text style={styles.itemSub}>{sub}</Text>}
        </View>
        {Boolean(badge) &&
            <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
            </View>
        }
    </Pressable>
);

type PeopleProps = {
    visible: boolean;
    onClose: () => void;
    call: Call | null;
    room: Room;
    connectionId: string;
    api: GomonApi | null;
    toast: (m: string) => void;
    refresh: () => void;
};

/** People in the call (the server roster) with their mic/camera, hands first; moderators also
 *  get the lobby (admit / deny), "mute everyone" and per-person actions. */
export const PeopleSheet = ({visible, onClose, call, room, connectionId, api, toast, refresh}: PeopleProps) => {
    const intl = useIntl();
    const conf = confOf(call);
    const [target, setTarget] = useState<Connection | null>(null);
    const moderator = call?.my_role === 'host' || call?.my_role === 'cohost';
    const lobby = moderator ? lobbyOf(call) : [];
    const present = (call?.connections ?? []).filter((c) => c.state === 'CONNECTED' || c.state === 'CONNECTING');
    const invited = (call?.invitations ?? []).filter((i) => !present.some((c) => c.principal_id === i.invitee_id));
    const roleOf = (principal?: string, kind?: string) => {
        if (kind === 'guest') {
            return intl.formatMessage(messages.guest);
        }
        if (principal && principal === call?.host_id) {
            return intl.formatMessage(messages.host);
        }
        if (principal && call?.cohost_ids?.includes(principal)) {
            return intl.formatMessage(messages.cohost);
        }
        return '';
    };
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={`${intl.formatMessage(messages.participants)} · ${present.length}`}
            testID='gomon_call.people'
        >
            <ScrollView>
                {lobby.length > 0 &&
                    <>
                        <Text style={styles.section}>{`${intl.formatMessage(messages.lobby)} · ${lobby.length}`}</Text>
                        {call?.locked && <Text style={styles.hint}>{intl.formatMessage(messages.locked)}</Text>}
                        {lobby.map((a) => (
                            <View
                                key={a.admission_id}
                                style={styles.row}
                                testID={`gomon_call.lobby.${a.admission_id}`}
                            >
                                <Avatar
                                    name={a.display_name}
                                    id={a.admission_id}
                                    small={true}
                                />
                                <View style={styles.grow}>
                                    <Text
                                        style={styles.name}
                                        numberOfLines={1}
                                    >
                                        {a.display_name}
                                    </Text>
                                    <Text style={styles.sub}>{intl.formatMessage(messages.guest)}</Text>
                                </View>
                                <Pressable
                                    style={[styles.btn, styles.btnOff]}
                                    onPress={() => run(() => api!.admission(a.admission_id, 'deny'), toast).finally(refresh)}
                                    testID='gomon_call.lobby.deny'
                                >
                                    <Text style={styles.btnText}>{intl.formatMessage(messages.deny)}</Text>
                                </Pressable>
                                <Pressable
                                    style={[styles.btn, call?.locked && styles.btnOff]}
                                    disabled={call?.locked}
                                    onPress={() => run(() => api!.admission(a.admission_id, 'admit'), toast).finally(refresh)}
                                    testID='gomon_call.lobby.admit'
                                >
                                    <Text style={styles.btnText}>{intl.formatMessage(messages.admit)}</Text>
                                </Pressable>
                            </View>
                        ))}
                    </>
                }
                {moderator && conf.can.mute_all && present.length > 1 &&
                    <SheetItem
                        icon='microphone-off'
                        text={intl.formatMessage(messages.muteAll)}
                        onPress={() => run(async () => {
                            const r = await api!.muteAll(call!.call_id);
                            toast(intl.formatMessage(messages.mutedAll, {count: r.muted_connections}));
                        }, toast).finally(refresh)}
                        testID='gomon_call.people.mute_all'
                    />
                }
                {conf.hands.length > 0 &&
                    <>
                        <Text style={styles.section}>{`${intl.formatMessage(messages.hands)} · ${conf.hands.length}`}</Text>
                        {conf.hands.map((h) => (
                            <View
                                key={h.connection_ids[0]}
                                style={styles.row}
                            >
                                <CompassIcon
                                    name='hand-right'
                                    size={20}
                                    color='#f5ab00'
                                />
                                <Text style={[styles.name, styles.grow]}>{h.position ? `${h.position}. ${h.display_name}` : h.display_name}</Text>
                            </View>
                        ))}
                    </>
                }
                {present.map((c) => {
                    const lk = room.getParticipantByIdentity(c.connection_id);
                    const role = roleOf(c.principal_id, c.kind);
                    const me = c.connection_id === connectionId;
                    return (
                        <View
                            key={c.connection_id}
                            style={styles.row}
                            testID={`gomon_call.people.${me ? 'me' : c.connection_id}`}
                        >
                            <Avatar
                                name={c.display_name}
                                id={c.connection_id}
                                small={true}
                            />
                            <View style={styles.grow}>
                                <Text
                                    style={styles.name}
                                    numberOfLines={1}
                                >
                                    {me ? intl.formatMessage(messages.you, {name: c.display_name}) : c.display_name}
                                </Text>
                                {Boolean(role) && <Text style={styles.sub}>{role}</Text>}
                            </View>
                            {moderator && !me && api &&
                                <Pressable
                                    onPress={() => setTarget(c)}
                                    accessibilityRole='button'
                                    accessibilityLabel={`${intl.formatMessage(messages.participantActions)}: ${c.display_name}`}
                                    hitSlop={8}
                                    testID={`gomon_call.people.actions.${c.connection_id}`}
                                >
                                    <CompassIcon
                                        name='dots-vertical'
                                        size={22}
                                        color='#fff'
                                    />
                                </Pressable>
                            }
                            <CompassIcon
                                name={lk?.isCameraEnabled ? 'video-outline' : 'video-off-outline'}
                                size={20}
                                color={lk?.isCameraEnabled ? '#fff' : MUTED}
                                accessibilityLabel={intl.formatMessage(lk?.isCameraEnabled ? messages.cameraOff : messages.cameraOn)}
                            />
                            <CompassIcon
                                name={lk?.isMicrophoneEnabled ? 'microphone' : 'microphone-off'}
                                size={20}
                                color={lk?.isMicrophoneEnabled ? '#fff' : '#ff6b6b'}
                                accessibilityLabel={intl.formatMessage(lk?.isMicrophoneEnabled ? messages.mute : messages.unmute)}
                            />
                        </View>
                    );
                })}
                {invited.length > 0 &&
                    <>
                        <Text style={styles.section}>{intl.formatMessage(messages.invitedList)}</Text>
                        {invited.map((i) => (
                            <View
                                key={i.invitation_id}
                                style={styles.row}
                            >
                                <Avatar
                                    name={i.invitee_name}
                                    id={i.invitee_id}
                                    small={true}
                                />
                                <View style={styles.grow}>
                                    <Text style={styles.name}>{i.invitee_name}</Text>
                                    <Text style={styles.sub}>{intl.formatMessage(messages.invState, {state: i.state})}</Text>
                                </View>
                            </View>
                        ))}
                    </>
                }
            </ScrollView>
            <ParticipantActions
                target={target}
                onClose={() => setTarget(null)}
                api={api}
                call={call}
                conf={conf}
                room={room}
                toast={toast}
                refresh={refresh}
            />
        </Sheet>
    );
};

const timeOf = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const Message = ({m, prev, store}: {m: ChatMessage; prev?: ChatMessage; store: ChatStore}) => {
    const intl = useIntl();
    const grouped = prev && !prev.deleted && !m.deleted && prev.author.name === m.author.name && prev.source === m.source &&
        new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 3 * 60_000;
    const openFile = async () => {
        try {
            tryOpenURL((await store.link(m.file!.file_id, m.file!.kind === 'image')).url);
        } catch (e) {
            logDebug('gomon chat: file link', e);
        }
    };
    let body: ReactNode = null;
    if (m.deleted) {
        body = <Text style={styles.msgDeleted}>{intl.formatMessage(messages.chatDeleted)}</Text>;
    } else {
        body = (
            <>
                {Boolean(m.text) && <Text style={styles.msgText}>{m.text}</Text>}
                {m.file &&
                    <FileCard
                        file={m.file}
                        store={store}
                        onOpen={openFile}
                    />
                }
            </>
        );
    }
    return (
        <View
            style={styles.msg}
            testID={`gomon_call.chat.msg.${m.id}`}
        >
            {!grouped &&
                <View style={styles.msgHead}>
                    <Text style={styles.msgName}>{m.author.me ? intl.formatMessage(messages.you, {name: m.author.name}) : m.author.name}</Text>
                    {m.author.kind === 'guest' && <Text style={styles.msgTag}>{intl.formatMessage(messages.guest)}</Text>}
                    {m.source === 'mattermost' && <Text style={styles.msgTag}>{'Mattermost'}</Text>}
                    <Text style={styles.msgTime}>{timeOf(m.created_at)}</Text>
                </View>
            }
            {body}
        </View>
    );
};

/** A file in the chat: an image shows a preview (a short-lived inline link), a tap opens it. */
const FileCard = ({file, store, onOpen}: {file: ChatFile; store: ChatStore; onOpen: () => void}) => {
    const intl = useIntl();
    const [thumb, setThumb] = useState<string | null>(null);
    useEffect(() => {
        let off = false;
        if (file.kind === 'image') {
            store.link(file.file_id, true).then((l) => !off && setThumb(l.url)).catch(() => undefined);
        }
        return () => {
            off = true;
        };
    }, [file.file_id, file.kind, store]);
    return (
        <Pressable
            style={styles.file}
            onPress={onOpen}
            accessibilityRole='link'
            accessibilityLabel={intl.formatMessage(messages.fileOpen, {name: file.name})}
            testID='gomon_call.chat.file'
        >
            {thumb &&
                <Image
                    source={{uri: thumb}}
                    style={styles.thumb}
                    resizeMode='cover'
                    onError={() => setThumb(null)}
                />
            }
            <View style={styles.fileRow}>
                <CompassIcon
                    name={file.kind === 'image' ? 'file-image-outline' : 'file-generic-outline'}
                    size={22}
                    color='#fff'
                />
                <View style={styles.grow}>
                    <Text
                        style={styles.msgLink}
                        numberOfLines={1}
                    >
                        {file.name}
                    </Text>
                    <Text style={styles.msgTime}>{fmtSize(file.size)}</Text>
                </View>
            </View>
        </Pressable>
    );
};

type Pending = {file: LocalFile; progress: number};

/** The meeting chat (the same messages as the web panel, Mattermost thread replies included),
 *  with files: from the gallery, the camera or the device's files, as the web's attach button. */
export const ChatSheet = ({visible, onClose, store, api}: {visible: boolean; onClose: () => void; store: ChatStore | null; api: GomonApi | null}) => {
    const intl = useIntl();
    const [pending, setPending] = useState<Pending | null>(null);
    const [choose, setChoose] = useState(false);
    const picker = useMemo(() => new FilePickerUtil(intl, (files) => {
        const f = files[0];
        const uri = f?.localPath ?? (f as {uri?: string})?.uri;
        if (f && uri) {
            setPending({file: {uri, name: f.name, mime: f.mime_type, size: f.size}, progress: 0});
        }
    }), [intl]);
    const [, tick] = useReducer((n: number) => n + 1, 0);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const list = useRef<FlatList<ChatMessage>>(null);

    useEffect(() => store?.subscribe(tick), [store]);
    useEffect(() => {
        if (!store || !visible) {
            return undefined;
        }
        store.setOpen(true);
        store.refresh();
        return () => store.setOpen(false);
    }, [store, visible]);

    const tooBig = Boolean(pending && store && store.files.max_bytes > 0 && (pending.file.size ?? 0) > store.files.max_bytes);
    const send = async () => {
        const t = text.trim();
        if ((!t && !pending) || !store || tooBig) {
            return;
        }
        setBusy(true);
        setErr('');
        try {
            let fileId: string | null = null;
            if (pending && api) {
                const f = await api.upload(store.uploadPath(pending.file.name), pending.file, (progress) => setPending((x) => (x ? {...x, progress} : x)));
                fileId = f.file_id;
            }
            await store.post(t, fileId);
            setText('');
            setPending(null);
            hapticFeedback();
        } catch (e) {
            setErr(chatError(e));
        } finally {
            setBusy(false);
        }
    };
    const attach = (from: 'gallery' | 'camera' | 'files') => {
        setChoose(false);
        setErr('');

        // the picker opens over the call: give the choice sheet time to close first
        setTimeout(() => {
            if (from === 'gallery') {
                picker.attachFileFromPhotoGallery(1);
            } else if (from === 'camera') {
                picker.attachFileFromCamera({quality: 0.8, mediaType: 'photo', saveToPhotos: false});
            } else {
                picker.attachFileFromFiles(undefined, false);
            }
        }, 350);
    };

    const msgs = store?.list() ?? [];
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(messages.chat)}
            tall={true}
            testID='gomon_call.chat'
        >
            <FlatList
                ref={list}
                style={styles.grow}
                data={msgs}
                keyExtractor={(m) => String(m.id)}
                renderItem={({item, index}) => (
                    <Message
                        m={item}
                        prev={msgs[index - 1]}
                        store={store!}
                    />
                )}
                onContentSizeChange={() => list.current?.scrollToEnd({animated: false})}
                ListEmptyComponent={store?.loaded ? <Text style={styles.empty}>{intl.formatMessage(messages.chatEmpty)}</Text> : null}
            />
            {Boolean(err || store?.error) && <Text style={styles.error}>{err || store?.error}</Text>}
            {pending &&
                <View
                    style={styles.pending}
                    testID='gomon_call.chat.pending'
                >
                    <CompassIcon
                        name='paperclip'
                        size={18}
                        color='#fff'
                    />
                    <Text
                        style={[styles.name, styles.grow]}
                        numberOfLines={1}
                    >
                        {pending.file.name}
                    </Text>
                    <Text style={styles.msgTime}>
                        {busy ? intl.formatMessage(messages.uploading, {percent: Math.round(pending.progress * 100)}) : fmtSize(pending.file.size ?? 0)}
                    </Text>
                    {!busy &&
                        <Pressable
                            onPress={() => setPending(null)}
                            accessibilityRole='button'
                            accessibilityLabel={intl.formatMessage(messages.attachRemove)}
                            hitSlop={8}
                        >
                            <CompassIcon
                                name='close'
                                size={18}
                                color='#fff'
                            />
                        </Pressable>
                    }
                </View>
            }
            {tooBig && <Text style={styles.error}>{intl.formatMessage(messages.fileTooBig, {size: fmtSize(store!.files.max_bytes)})}</Text>}
            {store?.canPost !== false &&
                <View style={styles.composer}>
                    {store?.files.can_upload &&
                        <Pressable
                            style={styles.send}
                            onPress={() => setChoose(true)}
                            disabled={busy}
                            accessibilityRole='button'
                            accessibilityLabel={intl.formatMessage(messages.attach)}
                            testID='gomon_call.chat.attach'
                        >
                            <CompassIcon
                                name='paperclip'
                                size={24}
                                color='#fff'
                            />
                        </Pressable>
                    }
                    <TextInput
                        style={styles.input}
                        value={text}
                        onChangeText={setText}
                        placeholder={intl.formatMessage(messages.chatPlaceholder)}
                        placeholderTextColor={MUTED}
                        multiline={true}
                        maxLength={4000}
                        testID='gomon_call.chat.input'
                    />
                    <Pressable
                        style={styles.send}
                        onPress={send}
                        disabled={busy || (!text.trim() && !pending) || tooBig}
                        accessibilityRole='button'
                        accessibilityLabel={intl.formatMessage(messages.chatSend)}
                        testID='gomon_call.chat.send'
                    >
                        <CompassIcon
                            name='send'
                            size={24}
                            color={(text.trim() || pending) && !tooBig ? '#7aa7ff' : MUTED}
                        />
                    </Pressable>
                </View>
            }
            <Sheet
                visible={choose}
                onClose={() => setChoose(false)}
                testID='gomon_call.chat.attach_sheet'
            >
                <SheetItem
                    icon='image-outline'
                    text={intl.formatMessage(messages.attachGallery)}
                    onPress={() => attach('gallery')}
                    testID='gomon_call.chat.attach.gallery'
                />
                <SheetItem
                    icon='camera-outline'
                    text={intl.formatMessage(messages.attachCamera)}
                    onPress={() => attach('camera')}
                    testID='gomon_call.chat.attach.camera'
                />
                <SheetItem
                    icon='file-generic-outline'
                    text={intl.formatMessage(messages.attachFiles)}
                    onPress={() => attach('files')}
                    testID='gomon_call.chat.attach.files'
                />
            </Sheet>
        </Sheet>
    );
};

/** Invite colleagues (gomon's user directory, synced from Mattermost) into the call. */
export const InviteSheet = ({visible, onClose, api, call, toast}: {visible: boolean; onClose: () => void; api: GomonApi | null; call: Call | null; toast: (m: string) => void}) => {
    const intl = useIntl();
    const [q, setQ] = useState('');
    const [users, setUsers] = useState<UserRef[]>([]);
    const [sent, setSent] = useState<string[]>([]);
    useEffect(() => {
        if (!visible || !api) {
            return undefined;
        }
        const load = async () => {
            try {
                setUsers((await api.users(q)).users);
            } catch (e) {
                logDebug('gomon invite: users', e);
            }
        };
        const h = setTimeout(load, 200);
        return () => clearTimeout(h);
    }, [q, api, visible]);
    const busy = new Set([
        call?.host_id,
        ...sent,
        ...(call?.connections ?? []).filter((c) => c.state === 'CONNECTED').map((c) => c.principal_id),
        ...(call?.invitations ?? []).filter((i) => ['CREATED', 'DISPATCHING', 'RINGING', 'ACCEPTED'].includes(i.state)).map((i) => i.invitee_id),
    ]);
    const invite = async (u: UserRef) => {
        if (!api || !call) {
            return;
        }
        try {
            await api.invite(call.call_id, [u.id]);
            setSent((s) => [...s, u.id]);
            toast(intl.formatMessage(messages.invited, {name: u.display_name}));
        } catch (e) {
            toast((e as ApiError)?.message || intl.formatMessage(messages.error));
        }
    };
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(messages.invite)}
            tall={true}
            testID='gomon_call.invite'
        >
            <TextInput
                style={styles.search}
                value={q}
                onChangeText={setQ}
                placeholder={intl.formatMessage(messages.search)}
                placeholderTextColor={MUTED}
                autoCorrect={false}
                testID='gomon_call.invite.search'
            />
            <FlatList
                style={styles.grow}
                data={users}
                keyExtractor={(u) => u.id}
                keyboardShouldPersistTaps='handled'
                renderItem={({item: u}) => {
                    const done = busy.has(u.id);
                    return (
                        <View style={styles.row}>
                            <Avatar
                                name={u.display_name}
                                id={u.id}
                                small={true}
                            />
                            <Text
                                style={[styles.name, styles.grow]}
                                numberOfLines={1}
                            >
                                {u.display_name}
                            </Text>
                            <Pressable
                                style={[styles.btn, done && styles.btnOff]}
                                disabled={done}
                                onPress={() => invite(u)}
                                testID={`gomon_call.invite.${u.username}`}
                            >
                                {done ? (
                                    <CompassIcon
                                        name='check'
                                        size={16}
                                        color='#fff'
                                    />
                                ) : (
                                    <Text style={styles.btnText}>{intl.formatMessage(messages.invite)}</Text>
                                )}
                            </Pressable>
                        </View>
                    );
                }}
            />
        </Sheet>
    );
};
