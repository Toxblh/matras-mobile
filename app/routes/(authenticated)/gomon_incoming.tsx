// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useNavigation} from 'expo-router';
import {useEffect} from 'react';

import GomonIncomingScreen, {type GomonIncomingProps} from '@gomon/screens/incoming_screen';
import {usePropsFromParams} from '@hooks/props_from_params';

export default function GomonIncomingRoute() {
    const props = usePropsFromParams<GomonIncomingProps>();
    const navigation = useNavigation();

    useEffect(() => {
        navigation.setOptions({
            headerShown: false,
            gestureEnabled: false,
            presentation: 'transparentModal',
            animation: 'fade',
            contentStyle: {backgroundColor: 'transparent'},
        });
    }, [navigation]);

    return (<GomonIncomingScreen {...props}/>);
}
