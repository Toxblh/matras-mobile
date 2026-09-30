// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {useIntl} from 'react-intl';
import {StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {selfUpdateProgress} from '@managers/self_update_manager';

const styles = StyleSheet.create({
    container: {position: 'absolute', left: 16, right: 16, borderRadius: 8, backgroundColor: '#1e325c', padding: 12, elevation: 4},
    text: {color: '#fff', fontSize: 14},
    track: {marginTop: 8, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.24)', overflow: 'hidden'},
    bar: {height: 4, backgroundColor: '#fff'},
});

// matras: download progress of the self-update (non-blocking bar at the bottom).
const SelfUpdateProgress = () => {
    const intl = useIntl();
    const insets = useSafeAreaInsets();
    const [progress, setProgress] = useState(selfUpdateProgress.value);

    useEffect(() => {
        const sub = selfUpdateProgress.subscribe(setProgress);
        return () => sub.unsubscribe();
    }, []);

    if (progress === undefined) {
        return null;
    }

    const percent = progress >= 0 ? Math.round(progress * 100) : undefined;
    return (
        <View
            pointerEvents='none'
            style={[styles.container, {bottom: insets.bottom + 72}]}
        >
            <Text style={styles.text}>
                {percent === undefined ? intl.formatMessage({id: 'matras.update.downloading', defaultMessage: 'Downloading the update…'}) : intl.formatMessage({id: 'matras.update.downloading_percent', defaultMessage: 'Downloading the update… {percent}%'}, {percent})}
            </Text>
            {percent !== undefined && (
                <View style={styles.track}>
                    <View style={[styles.bar, {width: `${percent}%`}]}/>
                </View>
            )}
        </View>
    );
};

export default SelfUpdateProgress;
