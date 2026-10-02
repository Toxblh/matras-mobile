// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {useIntl} from 'react-intl';
import {Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View} from 'react-native';

import CompassIcon from '@components/compass_icon';
import {hapticFeedback} from '@utils/general';

import {DTMF_KEYS, SIP_STATE, dialInText, dtmfCode, legInFlight, sipError, sipOf, type DirEmp, type DirPartner, type Leg} from './call_core';
import {messages} from './messages';
import {MUTED, Sheet, sheetStyles} from './sheets';

import type {Call, GomonApi} from './api';
import type {Room} from 'livekit-client';

const TONE: Record<string, string> = {ok: '#3db887', warn: '#f5ab00', danger: '#ff6b6b', accent: '#7aa7ff'};
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];

const styles = StyleSheet.create({
    tabs: {flexDirection: 'row', marginHorizontal: 16, marginVertical: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)'},
    tab: {flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8},
    tabOn: {backgroundColor: '#1c58d9'},
    keypad: {width: (64 * 3) + (12 * 2), alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8},
    key: {width: 64, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)'},
    keyText: {color: '#fff', fontSize: 22},
    number: {color: '#fff', fontSize: 22, textAlign: 'center', marginHorizontal: 16, marginVertical: 6, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)'},
    dialBtn: {alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24, backgroundColor: '#3db887', marginVertical: 6},
    dialBtnOff: {opacity: 0.5},
    dialIn: {marginHorizontal: 16, marginVertical: 6, padding: 12, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.06)', gap: 4},
    big: {color: '#fff', fontSize: 18, fontWeight: '600'},
    leg: {paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)'},
    legHead: {flexDirection: 'row', alignItems: 'center', gap: 8},
    legActs: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4},
    state: {fontSize: 12, fontWeight: '600'},
    tones: {alignItems: 'center'},
    sent: {color: '#fff', fontSize: 18, letterSpacing: 2, minHeight: 24},
    error: {color: '#ff6b6b', fontSize: 13, paddingHorizontal: 16, paddingVertical: 4},
    shareBtn: {alignSelf: 'flex-start', marginTop: 4},
});

const Keypad = ({keys, onKey, testPrefix}: {keys: string[]; onKey: (k: string) => void; testPrefix: string}) => {
    const intl = useIntl();
    return (
        <View style={styles.keypad}>
            {keys.map((k) => (
                <Pressable
                    key={k}
                    style={styles.key}
                    onPress={() => {
                        hapticFeedback();
                        onKey(k);
                    }}
                    accessibilityRole='button'
                    accessibilityLabel={k === '⌫' ? intl.formatMessage(messages.erase) : k}
                    testID={`${testPrefix}.${k === '⌫' ? 'erase' : k}`}
                >
                    <Text style={styles.keyText}>{k}</Text>
                </Pressable>
            ))}
        </View>
    );
};

// Tones into the call (an extension, a voice menu on the other end): LiveKit SIP turns them into
// RFC 4733 events on every phone leg of the room.
const Tones = ({room, toast}: {room: Room; toast: (m: string) => void}) => {
    const intl = useIntl();
    const [sent, setSent] = useState('');
    const send = (k: string) => {
        room.localParticipant.publishDtmf(dtmfCode(k), k).
            then(() => setSent((s) => (s + k).slice(-16))).
            catch(() => toast(intl.formatMessage(messages.toneFailed)));
    };
    return (
        <View
            style={styles.tones}
            testID='gomon_call.phone.tones'
        >
            <Text
                style={styles.sent}
                accessibilityLiveRegion='polite'
            >
                {sent}
            </Text>
            <Keypad
                keys={DTMF_KEYS}
                onKey={send}
                testPrefix='gomon_call.phone.dtmf'
            />
        </View>
    );
};

const LegRow = ({l, api, call, room, moderator, myConnection, toast, refresh}: {
    l: Leg; api: GomonApi; call: Call; room: Room; moderator: boolean; myConnection: string; toast: (m: string) => void; refresh: () => void;
}) => {
    const intl = useIntl();
    const [busy, setBusy] = useState('');
    const [tones, setTones] = useState(false);
    const [label, tone] = SIP_STATE[l.state] ?? [l.state, ''];
    const act = async (action: 'cancel' | 'hangup' | 'redial') => {
        setBusy(action);
        try {
            await api.sipLeg(l.leg_id, action);
            hapticFeedback();
            refresh();
        } catch (e) {
            toast(sipError(e));
        } finally {
            setBusy('');
        }
    };
    const inFlight = legInFlight(l);
    const myPrincipal = call.connections.find((x) => x.connection_id === myConnection)?.principal_id;
    const mine = moderator || (Boolean(l.requested_by) && l.requested_by === myPrincipal);
    const number = moderator ? l.number : l.number_masked;
    const btn = (key: string, text: string, onPress: () => void, danger = false) => (
        <Pressable
            key={key}
            style={[sheetStyles.btn, danger ? sheetStyles.btnDanger : sheetStyles.btnOff]}
            disabled={Boolean(busy)}
            onPress={onPress}
            testID={`gomon_call.phone.leg.${key}`}
        >
            <Text style={sheetStyles.btnText}>{text}</Text>
        </Pressable>
    );
    return (
        <View
            style={styles.leg}
            testID={`gomon_call.phone.leg_${l.leg_id}`}
        >
            <View style={styles.legHead}>
                <CompassIcon
                    name={l.direction === 'inbound' ? 'phone-in-talk' : 'phone-outline'}
                    size={18}
                    color='#fff'
                />
                <Text
                    style={[sheetStyles.name, sheetStyles.grow]}
                    numberOfLines={1}
                >
                    {l.display_name || number}
                </Text>
                <Text
                    style={[styles.state, {color: TONE[tone] ?? MUTED}]}
                    testID='gomon_call.phone.leg.state'
                >
                    {label}
                </Text>
            </View>
            <Text style={sheetStyles.sub}>
                {`${intl.formatMessage(l.direction === 'inbound' ? messages.legInbound : messages.legOutbound)} · ${number}${l.sip_status ? ` · SIP ${l.sip_status}` : ''}`}
            </Text>
            {l.state === 'UNKNOWN_OUTCOME' && <Text style={sheetStyles.sub}>{intl.formatMessage(messages.legUnknown)}</Text>}
            <View style={styles.legActs}>
                {mine && (inFlight || l.state === 'UNKNOWN_OUTCOME') && btn('cancel', intl.formatMessage(messages.legCancel), () => act('cancel'))}
                {l.state === 'ANSWERED' && btn('tones', intl.formatMessage(messages.legTones), () => setTones(!tones))}
                {mine && (l.state === 'ANSWERED' || l.state === 'CONNECTING') && btn('hangup', intl.formatMessage(messages.legHangup), () => act('hangup'), true)}
                {mine && l.direction === 'outbound' && (l.terminal || l.state === 'UNKNOWN_OUTCOME') && btn('redial', intl.formatMessage(messages.legRedial), () => act('redial'))}
            </View>
            {tones && l.state === 'ANSWERED' &&
                <Tones
                    room={room}
                    toast={toast}
                />
            }
        </View>
    );
};

type Props = {
    visible: boolean;
    onClose: () => void;
    api: GomonApi | null;
    call: Call | null;
    room: Room;
    connectionId: string;
    toast: (m: string) => void;
    refresh: () => void;
};

/** True when the organisation has telephony for this call (the snapshot's `sip` part). */
export const hasSip = (call: Call | null) => {
    const sip = sipOf(call);
    return Boolean(sip.can_dial || sip.dial_in?.numbers.length || sip.legs?.length);
};

/** Phone (SIP): dial-in for partners, dial a number or an employee, the phone lines, DTMF. */
export const PhoneSheet = ({visible, onClose, api, call, room, connectionId, toast, refresh}: Props) => {
    const intl = useIntl();
    const sip = sipOf(call);
    const moderator = call?.my_role === 'host' || call?.my_role === 'cohost';
    const [tab, setTab] = useState<'number' | 'people'>('number');
    const [num, setNum] = useState('');
    const [q, setQ] = useState('');
    const [dir, setDir] = useState<{employees: DirEmp[]; partners: DirPartner[]} | null>(null);
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');
    useEffect(() => {
        if (!visible || tab !== 'people' || !api) {
            return undefined;
        }
        let live = true;
        const load = async () => {
            const d = await api.sipDirectory(q).catch(() => ({employees: [], partners: []}));
            if (live) {
                setDir(d);
            }
        };
        const t = setTimeout(load, 200);
        return () => {
            live = false;
            clearTimeout(t);
        };
    }, [q, tab, api, visible]);
    if (!api || !call) {
        return null;
    }
    const dial = async (body: Record<string, unknown>, id: string) => {
        setBusy(id);
        setErr('');
        try {
            await api.sipDial(call.call_id, body);
            hapticFeedback();
            setNum('');
            refresh();
        } catch (e) {
            setErr(sipError(e));
        } finally {
            setBusy('');
        }
    };
    const legs = sip.legs ?? [];
    const active = legs.filter((l) => !l.terminal);
    const recent = legs.filter((l) => l.terminal).slice(0, 6);
    const share = () => Share.share({message: dialInText(call.title, sip.dial_in!, call.meet_url)}).catch(() => undefined);
    const row = (l: Leg) => (
        <LegRow
            key={l.leg_id}
            l={l}
            api={api}
            call={call}
            room={room}
            moderator={moderator}
            myConnection={connectionId}
            toast={toast}
            refresh={refresh}
        />
    );
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(messages.phone)}
            tall={true}
            testID='gomon_call.phone'
        >
            <ScrollView keyboardShouldPersistTaps='handled'>
                {Boolean(sip.dial_in?.numbers.length) &&
                    <View
                        style={styles.dialIn}
                        testID='gomon_call.phone.dial_in'
                    >
                        <Text style={sheetStyles.sub}>{intl.formatMessage(messages.dialIn)}</Text>
                        <Text
                            style={styles.big}
                            selectable={true}
                        >
                            {sip.dial_in!.numbers.join(', ')}{sip.dial_in!.pin ? `   PIN ${sip.dial_in!.pin}` : ''}
                        </Text>
                        <Text style={sheetStyles.sub}>{intl.formatMessage(messages.dialInHint)}</Text>
                        <Pressable
                            style={[sheetStyles.btn, styles.shareBtn]}
                            onPress={share}
                            testID='gomon_call.phone.dial_in.share'
                        >
                            <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.dialInShare)}</Text>
                        </Pressable>
                    </View>
                }
                {sip.can_dial ? (
                    <>
                        <Text style={sheetStyles.section}>{intl.formatMessage(messages.dialTitle)}</Text>
                        <View
                            style={styles.tabs}
                            accessibilityRole='tablist'
                        >
                            {(['number', 'people'] as const).map((t) => (
                                <Pressable
                                    key={t}
                                    style={[styles.tab, tab === t && styles.tabOn]}
                                    onPress={() => setTab(t)}
                                    accessibilityRole='tab'
                                    accessibilityState={{selected: tab === t}}
                                    testID={`gomon_call.phone.tab_${t}`}
                                >
                                    <Text style={sheetStyles.btnText}>{intl.formatMessage(t === 'number' ? messages.dialNumber : messages.dialPeople)}</Text>
                                </Pressable>
                            ))}
                        </View>
                        {tab === 'number' ? (
                            <>
                                <TextInput
                                    style={styles.number}
                                    value={num}
                                    onChangeText={setNum}
                                    placeholder={intl.formatMessage(messages.phoneNumber)}
                                    placeholderTextColor={MUTED}
                                    keyboardType='phone-pad'
                                    showSoftInputOnFocus={false}
                                    accessibilityLabel={intl.formatMessage(messages.phoneNumber)}
                                    testID='gomon_call.phone.number'
                                />
                                <Keypad
                                    keys={KEYPAD}
                                    onKey={(k) => setNum((n) => (k === '⌫' ? n.slice(0, -1) : n + k))}
                                    testPrefix='gomon_call.phone.key'
                                />
                                <Pressable
                                    style={[styles.dialBtn, (!num.trim() || busy === 'num') && styles.dialBtnOff]}
                                    disabled={!num.trim() || busy === 'num'}
                                    onPress={() => dial({number: num}, 'num')}
                                    accessibilityRole='button'
                                    accessibilityLabel={intl.formatMessage(messages.dial)}
                                    testID='gomon_call.phone.dial'
                                >
                                    <CompassIcon
                                        name='phone'
                                        size={20}
                                        color='#fff'
                                    />
                                    <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.dial)}</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <TextInput
                                    style={sheetStyles.search}
                                    value={q}
                                    onChangeText={setQ}
                                    placeholder={intl.formatMessage(messages.nameOrCompany)}
                                    placeholderTextColor={MUTED}
                                    autoCorrect={false}
                                    testID='gomon_call.phone.search'
                                />
                                {dir && dir.employees.length + dir.partners.length === 0 && <Text style={sheetStyles.hint}>{intl.formatMessage(messages.nobodyWithPhone)}</Text>}
                                {dir?.employees.map((e) => (
                                    <View
                                        key={e.id}
                                        style={sheetStyles.row}
                                        testID={`gomon_call.phone.emp_${e.id}`}
                                    >
                                        <View style={sheetStyles.grow}>
                                            <Text style={sheetStyles.name}>{e.display_name}</Text>
                                            <Text style={sheetStyles.sub}>{`${intl.formatMessage(messages.employee)} · ${e.number}${e.label ? ` · ${e.label}` : ''}`}</Text>
                                        </View>
                                        <Pressable
                                            style={sheetStyles.btn}
                                            disabled={busy === e.id}
                                            onPress={() => dial({user_id: e.id}, e.id)}
                                            accessibilityRole='button'
                                            accessibilityLabel={`${intl.formatMessage(messages.dial)}: ${e.display_name}`}
                                            testID='gomon_call.phone.call_emp'
                                        >
                                            <CompassIcon
                                                name='phone'
                                                size={16}
                                                color='#fff'
                                            />
                                        </Pressable>
                                    </View>
                                ))}
                                {dir?.partners.flatMap((p) => p.numbers.map((n) => (
                                    <View
                                        key={p.id + n.ref}
                                        style={sheetStyles.row}
                                    >
                                        <View style={sheetStyles.grow}>
                                            <Text style={sheetStyles.name}>{p.name}</Text>
                                            <Text style={sheetStyles.sub}>{`${p.company} · ${n.number_masked}${n.label ? ` · ${n.label}` : ''}`}</Text>
                                        </View>
                                        <Pressable
                                            style={sheetStyles.btn}
                                            disabled={busy === p.id + n.ref}
                                            onPress={() => dial({partner_id: p.id, partner_ref: n.ref}, p.id + n.ref)}
                                            accessibilityRole='button'
                                            accessibilityLabel={`${intl.formatMessage(messages.dial)}: ${p.name}`}
                                        >
                                            <CompassIcon
                                                name='phone'
                                                size={16}
                                                color='#fff'
                                            />
                                        </Pressable>
                                    </View>
                                )))}
                            </>
                        )}
                        {Boolean(err) && <Text style={styles.error}>{err}</Text>}
                    </>
                ) : (
                    <Text style={sheetStyles.hint}>{intl.formatMessage(messages.onlyHostDials)}</Text>
                )}
                <Text style={sheetStyles.section}>{intl.formatMessage(messages.phoneLines)}</Text>
                {active.length + recent.length === 0 && <Text style={sheetStyles.hint}>{intl.formatMessage(messages.noPhoneLines)}</Text>}
                {active.map(row)}
                {recent.length > 0 && <Text style={sheetStyles.section}>{intl.formatMessage(messages.recentLegs)}</Text>}
                {recent.map(row)}
            </ScrollView>
        </Sheet>
    );
};
