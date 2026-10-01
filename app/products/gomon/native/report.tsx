// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {useIntl} from 'react-intl';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';

import {hapticFeedback} from '@utils/general';

import {SYMPTOMS} from './call_core';
import {messages} from './messages';
import {MUTED, Sheet, sheetStyles} from './sheets';

const SYMPTOM_MSG = {
    no_one_hears_me: messages.symno_one_hears_me,
    cant_hear: messages.symcant_hear,
    no_video: messages.symno_video,
    video_freezes: messages.symvideo_freezes,
    cant_share: messages.symcant_share,
    cant_connect: messages.symcant_connect,
    other: messages.symother,
};

type Props = {
    visible: boolean;
    onClose: () => void;
    send: () => Promise<string>;
    comment: (reportId: string, symptoms: string[], text: string) => Promise<boolean>;
    toast: (m: string) => void;
};

/**
 * "Report a problem", as on the web: the diagnostics (the last ~30 s of stats, who publishes
 * what, the connection) go out the moment the sheet opens; symptoms and a comment are added to
 * the same report.
 */
const ReportSheet = ({visible, onClose, send, comment, toast}: Props) => {
    const intl = useIntl();
    const [reportId, setReportId] = useState('');
    const [symptoms, setSymptoms] = useState<string[]>([]);
    const [text, setText] = useState('');
    useEffect(() => {
        if (!visible) {
            return;
        }
        setReportId('');
        setSymptoms([]);
        setText('');
        send().then((id) => {
            if (id) {
                setReportId(id);
            } else {
                onClose();
                toast(intl.formatMessage(messages.error));
            }
        });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);
    const submit = async () => {
        onClose();
        const ok = await comment(reportId, symptoms, text);
        hapticFeedback();
        toast(intl.formatMessage(ok ? messages.reportCommentSent : messages.error));
    };
    return (
        <Sheet
            visible={visible}
            onClose={onClose}
            title={intl.formatMessage(messages.report)}
            testID='gomon_call.report'
        >
            <ScrollView keyboardShouldPersistTaps='handled'>
                <Text
                    style={sheetStyles.hint}
                    testID='gomon_call.report.id'
                >
                    {reportId ? `✅ ${intl.formatMessage(messages.reportSent, {id: reportId})}` : intl.formatMessage(messages.reportSending)}
                </Text>
                <Text style={sheetStyles.section}>{intl.formatMessage(messages.reportWhat)}</Text>
                <View
                    style={sheetStyles.chips}
                    accessibilityLabel={intl.formatMessage(messages.reportWhat)}
                >
                    {SYMPTOMS.map((k) => {
                        const on = symptoms.includes(k);
                        return (
                            <Pressable
                                key={k}
                                style={[sheetStyles.chip, on && sheetStyles.chipOn]}
                                onPress={() => setSymptoms(on ? symptoms.filter((x) => x !== k) : [...symptoms, k])}
                                accessibilityRole='checkbox'
                                accessibilityState={{checked: on}}
                                testID={`gomon_call.report.sym.${k}`}
                            >
                                <Text style={sheetStyles.chipText}>{intl.formatMessage(SYMPTOM_MSG[k])}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                <Text style={sheetStyles.hint}>{intl.formatMessage(messages.reportAsk)}</Text>
                <TextInput
                    style={sheetStyles.field}
                    value={text}
                    onChangeText={setText}
                    placeholder={intl.formatMessage(messages.reportPlaceholder)}
                    placeholderTextColor={MUTED}
                    multiline={true}
                    maxLength={2000}
                    testID='gomon_call.report.comment'
                />
                <View style={sheetStyles.actions}>
                    <Pressable
                        style={[sheetStyles.big, sheetStyles.btnOff]}
                        onPress={onClose}
                    >
                        <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.close)}</Text>
                    </Pressable>
                    <Pressable
                        style={[sheetStyles.big, sheetStyles.btn, (!reportId || (!text.trim() && !symptoms.length)) && sheetStyles.btnOff]}
                        disabled={!reportId || (!text.trim() && !symptoms.length)}
                        onPress={submit}
                        testID='gomon_call.report.send'
                    >
                        <Text style={sheetStyles.btnText}>{intl.formatMessage(messages.reportSend)}</Text>
                    </Pressable>
                </View>
            </ScrollView>
        </Sheet>
    );
};

export default ReportSheet;
