// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useReducer, useRef, useState} from 'react';
import {useIntl} from 'react-intl';
import {Pressable, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';

import CompassIcon from '@components/compass_icon';
import {hapticFeedback} from '@utils/general';
import {tryOpenURL} from '@utils/url';

import {fmtClock, recOf, recOptionsOf, recOutcome, recStartBody, recStarting, recStopping, RETENTION_LABEL, type RecMode} from './call_core';
import {messages} from './messages';
import {Sheet, SheetItem, sheetStyles} from './sheets';

import type {ApiError, Call, GomonApi} from './api';

const styles = StyleSheet.create({
    pill: {flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginBottom: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: 'rgba(210,75,78,0.9)'},
    pillPending: {backgroundColor: 'rgba(120,120,120,0.9)'},
    dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff'},
    pillText: {color: '#fff', fontSize: 12, fontWeight: '700'},
    dotOuter: {width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center'},
    dotInner: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff'},
    summary: {flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8},
    error: {color: '#ff6b6b', fontSize: 13, paddingHorizontal: 16, paddingVertical: 4},
});

const Radio = ({on, label, onPress, testID}: {on: boolean; label: string; onPress: () => void; testID: string}) => (
    <Pressable
        style={sheetStyles.radio}
        onPress={onPress}
        accessibilityRole='radio'
        accessibilityState={{checked: on}}
        testID={testID}
    >
        <View style={styles.dotOuter}>{on && <View style={styles.dotInner}/>}</View>
        <Text style={sheetStyles.itemText}>{label}</Text>
    </Pressable>
);

/** "● REC 1:23" for everyone (guests too), as the web's indicator; announces start and stop once. */
export const RecIndicator = ({api, call, toast}: {api: GomonApi | null; call: Call | null; toast: (m: string) => void}) => {
    const intl = useIntl();
    const rec = recOf(call);
    const [, tick] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        if (!rec) {
            return undefined;
        }
        const h = setInterval(tick, 1000);
        return () => clearInterval(h);
    }, [rec]);

    // undefined: no snapshot seen yet (what ran before we came is announced as "is being recorded")
    const seen = useRef<string | null | undefined>(undefined);
    const id = rec?.recording_id ?? null;
    useEffect(() => {
        if (!call) {
            return;
        }
        const prev = seen.current;
        seen.current = id;
        if (prev === undefined) {
            if (id) {
                toast(intl.formatMessage(messages.recAnnounceRunning, {name: rec!.by}));
            }
        } else if (id && id !== prev) {
            toast(intl.formatMessage(messages.recAnnounceStarted, {name: rec!.by}));
        } else if (!id && prev) {
            // say honestly how it ended (an egress can die on its own: CPU, storage, SFU)
            api?.recording(prev).then((r) => toast(recOutcome(r))).catch(() => toast(recOutcome(null)));
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, call !== null]);

    if (!rec) {
        return null;
    }
    const pending = recStarting(rec) || recStopping(rec);
    let label = intl.formatMessage(messages.recOn, {name: rec.by});
    if (recStarting(rec)) {
        label = intl.formatMessage(messages.recStarting);
    } else if (recStopping(rec)) {
        label = intl.formatMessage(messages.recStopping);
    }
    const elapsed = rec.state === 'RECORDING' ? (Date.now() - new Date(rec.started_at).getTime()) / 1000 : 0;
    return (
        <View
            style={[styles.pill, pending && styles.pillPending]}
            accessible={true}
            accessibilityRole='text'
            accessibilityLabel={label}
            testID='gomon_call.rec'
        >
            <View style={styles.dot}/>
            <Text style={styles.pillText}>{elapsed > 0 ? `REC ${fmtClock(elapsed)}` : 'REC'}</Text>
        </View>
    );
};

type SheetProps = {visible: boolean; onClose: () => void; api: GomonApi | null; call: Call | null; refresh: () => void};

/** Start (what to record, summary, retention) / stop the recording: the web's record dialog. */
export const RecordSheet = ({visible, onClose, api, call, refresh}: SheetProps) => {
    const intl = useIntl();
    const rec = recOf(call);
    const opts = recOptionsOf(call);
    const [mode, setMode] = useState<RecMode>('video');
    const [summary, setSummary] = useState(false);
    const [retention, setRetention] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    useEffect(() => {
        if (visible) {
            setErr('');
            setMode('video');
            setSummary(Boolean(opts?.summary_available));
            setRetention(opts?.default ?? 'unlimited');
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);
    if (!api || !call) {
        return null;
    }
    const act = async () => {
        setBusy(true);
        setErr('');
        try {
            if (rec) {
                await api.recStop(call.call_id);
            } else {
                await api.recStart(call.call_id, recStartBody(retention, mode, summary, opts));
            }
            hapticFeedback();
            onClose();
            refresh();
        } catch (e) {
            setErr((e as ApiError)?.message ?? String(e));
        } finally {
            setBusy(false);
        }
    };
    const recordings = () => {
        onClose();
        tryOpenURL(`${api.origin}/recordings`);
    };
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(rec ? messages.recStopTitle : messages.recStartTitle)}
            testID='gomon_call.record'
        >
            <ScrollView>
                {rec ? (
                    <Text style={sheetStyles.hint}>{intl.formatMessage(messages.recStopHint)}</Text>
                ) : (
                    <>
                        <Text style={sheetStyles.hint}>{intl.formatMessage(mode === 'audio' ? messages.recHintAudio : messages.recHintVideo)}</Text>
                        {opts && !opts.enabled && <Text style={styles.error}>{intl.formatMessage(messages.recNoStorage)}</Text>}
                        <Text style={sheetStyles.section}>{intl.formatMessage(messages.recWhat)}</Text>
                        <Radio
                            on={mode === 'video'}
                            label={intl.formatMessage(messages.recModeVideo)}
                            onPress={() => setMode('video')}
                            testID='gomon_call.record.mode_video'
                        />
                        <Radio
                            on={mode === 'audio'}
                            label={intl.formatMessage(messages.recModeAudio)}
                            onPress={() => setMode('audio')}
                            testID='gomon_call.record.mode_audio'
                        />
                        {opts?.summary_available &&
                            <View style={styles.summary}>
                                <View style={sheetStyles.grow}>
                                    <Text style={sheetStyles.itemText}>{intl.formatMessage(messages.recSummary)}</Text>
                                    <Text style={sheetStyles.itemSub}>{intl.formatMessage(messages.recSummaryHint)}</Text>
                                </View>
                                <Switch
                                    value={summary}
                                    onValueChange={setSummary}
                                    accessibilityLabel={intl.formatMessage(messages.recSummary)}
                                    testID='gomon_call.record.summary'
                                />
                            </View>
                        }
                        <Text style={sheetStyles.section}>{intl.formatMessage(messages.recRetention)}</Text>
                        {(opts?.allowed ?? ['unlimited']).map((r) => (
                            <Radio
                                key={r}
                                on={retention === r}
                                label={`${RETENTION_LABEL[r] ?? r}${r === opts?.default ? ` · ${intl.formatMessage(messages.recDefault)}` : ''}`}
                                onPress={() => setRetention(r)}
                                testID={`gomon_call.record.ret_${r}`}
                            />
                        ))}
                    </>
                )}
                {Boolean(err) && <Text style={styles.error}>{err}</Text>}
                <View style={sheetStyles.actions}>
                    <Pressable
                        style={[sheetStyles.big, sheetStyles.btnOff]}
                        onPress={onClose}
                        disabled={busy}
                    >
                        <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.cancel)}</Text>
                    </Pressable>
                    <Pressable
                        style={[sheetStyles.big, rec ? sheetStyles.btnDanger : sheetStyles.btn]}
                        onPress={act}
                        disabled={busy}
                        testID='gomon_call.record.confirm'
                    >
                        <Text style={sheetStyles.btnText}>{busy ? '…' : intl.formatMessage(rec ? messages.recStop : messages.recStart)}</Text>
                    </Pressable>
                </View>
                <SheetItem
                    icon='play-box-multiple-outline'
                    text={intl.formatMessage(messages.recordings)}
                    onPress={recordings}
                    testID='gomon_call.record.recordings'
                />
            </ScrollView>
        </Sheet>
    );
};

/** The record control in the "More" sheet (moderators): a ring to start, a dot to stop. */
export const RecordItem = ({call, onPress}: {call: Call | null; onPress: () => void}) => {
    const intl = useIntl();
    const rec = recOf(call);
    return (
        <Pressable
            style={sheetStyles.item}
            onPress={onPress}
            accessibilityRole='button'
            accessibilityLabel={intl.formatMessage(rec ? messages.recStop : messages.recStart)}
            testID='gomon_call.more.record'
        >
            <CompassIcon
                name={rec ? 'record-square-outline' : 'record-circle-outline'}
                size={22}
                color={rec ? '#ff6b6b' : '#fff'}
            />
            <Text style={sheetStyles.itemText}>{intl.formatMessage(rec ? messages.recStop : messages.recStart)}</Text>
        </Pressable>
    );
};
