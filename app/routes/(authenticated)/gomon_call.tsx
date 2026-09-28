// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useNavigation} from 'expo-router';
import {useEffect} from 'react';

import GomonCallScreen, {type GomonCallProps} from '@gomon/screens/call_screen';
import {usePropsFromParams} from '@hooks/props_from_params';

export default function GomonCallRoute() {
    const props = usePropsFromParams<GomonCallProps>();
    const navigation = useNavigation();

    useEffect(() => {
        // Leaving goes through the confirmation, never through a swipe.
        navigation.setOptions({
            headerShown: false,
            gestureEnabled: false,
            contentStyle: {backgroundColor: '#000000'},
        });
    }, [navigation]);

    return (<GomonCallScreen {...props}/>);
}
