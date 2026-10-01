// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {VideoTrack} from '@livekit/react-native';
import {ConnectionQuality, Track, type Participant, type TrackPublication} from 'livekit-client';
import React, {useState, type ReactNode} from 'react';
import {useIntl} from 'react-intl';
import {Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CompassIcon from '@components/compass_icon';

import {aspectOf, fitRows, handOf, tileKey, type Conf} from './call_core';
import {messages} from './messages';

import type {Flying} from './use_call';

type TrackReference = NonNullable<React.ComponentProps<typeof VideoTrack>['trackRef']>;
export type TileInfo = {key: string; p: Participant; pub?: TrackPublication; screen: boolean; local: boolean};
export type Layout = 'auto' | 'grid' | 'speaker';

const GAP = 6;

const styles = StyleSheet.create({
    stage: {flex: 1},
    fit: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: GAP},
    row: {flexDirection: 'row', gap: GAP},

    // the border is always there (only its colour changes): resizing the video's native view as
    // someone starts or stops speaking blanked the tile on Android
    tile: {borderRadius: 10, overflow: 'hidden', backgroundColor: '#1b1d22', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent'},
    speaking: {borderColor: '#3db887'},
    video: {...StyleSheet.absoluteFillObject},
    avatar: {width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center'},
    avatarSmall: {width: 40, height: 40, borderRadius: 20},
    initials: {color: '#fff', fontSize: 28, fontWeight: '600'},
    initialsSmall: {fontSize: 16},
    label: {position: 'absolute', left: 6, bottom: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 4},
    labelBox: {flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2},
    name: {color: '#fff', fontSize: 12, flexShrink: 1},
    hand: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5ab00', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1},
    handText: {color: '#000', fontSize: 11, fontWeight: '700'},
    corner: {position: 'absolute', top: 6, right: 6, flexDirection: 'row', gap: 4, alignItems: 'center'},
    bars: {flexDirection: 'row', alignItems: 'flex-end', gap: 1, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 4, padding: 3},
    bar: {width: 3, borderRadius: 1},
    pinBadge: {backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, padding: 2},
    fly: {position: 'absolute', bottom: 34, fontSize: 30},
    strip: {flexGrow: 0, marginTop: GAP},
    stripContent: {gap: GAP, paddingHorizontal: GAP},
    pager: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingTop: 4},
    pagerText: {color: '#fff', fontSize: 13},
    full: {flex: 1, backgroundColor: '#000'},
    fullClose: {position: 'absolute', right: 12, padding: 8, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)'},
});

const AVATAR_COLORS = ['#5d89ea', '#3db887', '#e57348', '#a35fd0', '#d24b4e', '#2f9fae', '#c58c1c'];
const colorOf = (id: string) => AVATAR_COLORS[[...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const Avatar = ({name, id, small}: {name: string; id: string; small?: boolean}) => (
    <View style={[styles.avatar, small && styles.avatarSmall, {backgroundColor: colorOf(id)}]}>
        <Text style={[styles.initials, small && styles.initialsSmall]}>{initialsOf(name)}</Text>
    </View>
);

const QUALITY_BARS: Record<string, number> = {[ConnectionQuality.Excellent]: 3, [ConnectionQuality.Good]: 2, [ConnectionQuality.Poor]: 1, [ConnectionQuality.Lost]: 0};

/** Three bars, like the web's quality dot: green/yellow/red by LiveKit's connection quality. */
export const QualityBars = ({quality}: {quality: ConnectionQuality}) => {
    const n = QUALITY_BARS[quality];
    if (n === undefined) {
        return null;
    }
    const color = n >= 2 ? '#3db887' : '#f5ab00';
    return (
        <View
            style={styles.bars}
            testID={`gomon_call.quality.${quality}`}
        >
            {[0, 1, 2].map((i) => (
                <View
                    key={i}
                    style={[styles.bar, {height: 4 + (i * 3), backgroundColor: i < n ? color : 'rgba(255,255,255,0.35)'}]}
                />
            ))}
        </View>
    );
};

/** Camera and screen tiles of everyone, the web's InCall `tiles`. */
export function buildTiles(participants: Participant[]): TileInfo[] {
    const out: TileInfo[] = [];
    for (const p of participants) {
        out.push({key: tileKey(p.identity, 'camera'), p, pub: p.getTrackPublication(Track.Source.Camera), screen: false, local: p.isLocal});
        const scr = p.getTrackPublication(Track.Source.ScreenShare);
        if (scr?.track) {
            out.push({key: tileKey(p.identity, 'screen'), p, pub: scr, screen: true, local: p.isLocal});
        }
    }
    return out;
}

type TileProps = {
    info: TileInfo;
    conf: Conf;
    width: number;
    height: number;
    pinned: boolean;
    mirror: boolean;
    flying: Flying[];
    onPress: () => void;
    small?: boolean;

    /** iOS: this tile's video goes to Picture in Picture when the app leaves the screen. */
    pip?: boolean;

    /** The app is in the background: only the PiP tile keeps its video (adaptive stream pauses the rest). */
    pipOnly?: boolean;
};

const Tile = ({info, conf, width, height, pinned, mirror, flying, onPress, small, pip, pipOnly}: TileProps) => {
    const intl = useIntl();
    const {p, pub, screen, local} = info;
    const visible = Boolean(pub?.track) && !pub?.isMuted;
    const name = p.name || p.identity;
    const hand = screen ? undefined : handOf(conf, p.identity);
    const speaking = p.isSpeaking && !screen;
    const mine = flying.filter((f) => f.identity === p.identity && !screen);
    const trackRef = visible && pub && (pip || !pipOnly) ? {participant: p, publication: pub, source: pub.source} as TrackReference : undefined;
    return (
        <Pressable
            onPress={onPress}
            style={[styles.tile, {width, height}, speaking && styles.speaking]}
            testID={`gomon_call.tile.${local ? 'local' : 'remote'}${screen ? '.screen' : ''}`}

            // a changing label re-creates the native view on Android and blanks the video under it:
            // the mic state is the mic-off icon's own label
            accessibilityLabel={name}
            accessibilityHint={intl.formatMessage(screen ? messages.tileOpenHint : messages.tilePinHint)}
        >
            {trackRef ? (
                <VideoTrack
                    trackRef={trackRef}
                    style={styles.video}
                    objectFit={screen ? 'contain' : 'cover'}
                    mirror={local && !screen && mirror}
                    iosPIP={pip ? {enabled: true, startAutomatically: true, stopAutomatically: true, preferredSize: pub?.dimensions ?? {width: 16, height: 9}} : undefined}
                />
            ) : (
                <Avatar
                    name={name}
                    id={p.identity}
                    small={small || height < 140}
                />
            )}
            <View style={styles.label}>
                {hand &&
                    <View
                        style={styles.hand}
                        testID='gomon_call.tile.hand'
                    >
                        <CompassIcon
                            name='hand-right'
                            size={12}
                            color='#000'
                        />
                        {Boolean(hand.position) && <Text style={styles.handText}>{hand.position}</Text>}
                    </View>
                }
                <View style={styles.labelBox}>
                    {screen &&
                        <CompassIcon
                            name='monitor-share'
                            size={12}
                            color='#fff'
                        />
                    }
                    <Text
                        style={styles.name}
                        numberOfLines={1}
                    >
                        {local ? intl.formatMessage(messages.you, {name}) : name}
                    </Text>
                    {!screen && !p.isMicrophoneEnabled &&
                        <CompassIcon
                            name='microphone-off'
                            size={12}
                            color='#ff6b6b'
                            testID='gomon_call.tile.mic_off'
                        />
                    }
                </View>
            </View>
            <View style={styles.corner}>
                {pinned &&
                    <View style={styles.pinBadge}>
                        <CompassIcon
                            name='pin'
                            size={14}
                            color='#fff'
                        />
                    </View>
                }
                {!local && !screen && !small && <QualityBars quality={p.connectionQuality}/>}
            </View>
            {mine.map((f, i) => (
                <Text
                    key={f.id}
                    style={[styles.fly, {left: `${15 + (((f.id * 23) + (i * 11)) % 60)}%`}]}
                >
                    {f.emoji}
                </Text>
            ))}
        </Pressable>
    );
};

/** The web's FitTiles: every tile keeps its video's aspect ratio, as large as the stage allows. */
const FitTiles = ({items, aspectFor, render}: {items: TileInfo[]; aspectFor: (t: TileInfo) => number; render: (t: TileInfo, w: number, h: number) => ReactNode}) => {
    const [box, setBox] = useState({w: 0, h: 0});
    const ar = items.map(aspectFor);
    const rows = fitRows(box.w, box.h, ar, GAP);
    return (
        <View
            style={styles.fit}
            onLayout={(e) => setBox({w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}
            testID='gomon_call.tiles'
        >
            {rows.map((r) => (
                <View
                    key={r.items.join(',')}
                    style={styles.row}
                >
                    {r.items.map((i) => (
                        <React.Fragment key={items[i].key}>
                            {render(items[i], Math.floor(r.height * ar[i]), r.height)}
                        </React.Fragment>
                    ))}
                </View>
            ))}
        </View>
    );
};

type StageProps = {
    pipOnly?: boolean;
    tiles: TileInfo[];
    conf: Conf;
    layout: Layout;
    lastSpeaker: string | null;
    mirror: boolean;
    flying: Flying[];
};

/** Grid / speaker view (meeting-web's ConfStage): pins and the large share are personal; a
 *  moderator's spotlight puts the same tile large for everyone. */
const Stage = ({tiles, conf, layout, lastSpeaker, mirror, flying, pipOnly}: StageProps) => {
    const intl = useIntl();
    const insets = useSafeAreaInsets();
    const win = useWindowDimensions();
    const [pins, setPins] = useState<string[]>([]);
    const [page, setPage] = useState(0);
    const [full, setFull] = useState<string | null>(null);

    const byKey = new Map(tiles.map((t) => [t.key, t]));
    const spotKeys = conf.spotlight.map((x) => tileKey(x.connection_id, x.source)).filter((k) => byKey.has(k));
    const pinKeys = pins.filter((k) => byKey.has(k));
    const shares = tiles.filter((t) => t.screen);

    // iOS Picture in Picture shows one remote video: the speaker's camera, else a shared screen.
    const remoteVideo = Platform.OS === 'ios' ? tiles.filter((t) => !t.local && t.pub?.track && !t.pub.isMuted) : [];
    const pipKey = (remoteVideo.find((t) => t.key === tileKey(lastSpeaker ?? '', 'camera')) || remoteVideo.find((t) => t.screen) || remoteVideo[0])?.key;

    let mode: 'grid' | 'speaker' = layout === 'grid' ? 'grid' : 'speaker';
    if (layout === 'auto') {
        mode = pinKeys.length || shares.length ? 'speaker' : 'grid';
    }
    if (spotKeys.length) {
        mode = 'speaker';
    }

    const portrait = win.height >= win.width;
    const aspectFor = (t: TileInfo) => {
        if (!t.pub?.track || t.pub.isMuted) {
            return 16 / 9; // an avatar tile, like the web's
        }

        // The local camera is rendered rotated by the device; its capture size is not.
        if (t.local && !t.screen) {
            return portrait ? 9 / 16 : 16 / 9;
        }
        return aspectOf(t.pub?.dimensions);
    };

    // A tap pins (a second tap unpins); a tap on a shared screen opens it full screen.
    const onTap = (t: TileInfo) => {
        if (t.screen && (pinKeys.includes(t.key) || mode === 'speaker')) {
            setFull(t.key);
            return;
        }
        setPins((p) => (p.includes(t.key) ? p.filter((x) => x !== t.key) : [...p, t.key]));
    };
    const tile = (t: TileInfo, w: number, h: number, small = false) => (
        <Tile
            info={t}
            conf={conf}
            width={w}
            height={h}
            pinned={pinKeys.includes(t.key)}
            mirror={mirror}
            flying={flying}
            onPress={() => onTap(t)}
            small={small}
            pip={t.key === pipKey}
            pipOnly={pipOnly}
        />
    );

    let body: ReactNode;
    if (mode === 'grid') {
        const ordered = [...pinKeys.map((k) => byKey.get(k)!), ...tiles.filter((t) => !pinKeys.includes(t.key))];
        const perPage = portrait ? 4 : 6;
        const pages = Math.max(1, Math.ceil(ordered.length / perPage));
        const pg = Math.min(page, pages - 1);
        body = (
            <>
                <FitTiles
                    items={ordered.slice(pg * perPage, (pg * perPage) + perPage)}
                    aspectFor={aspectFor}
                    render={tile}
                />
                {pages > 1 &&
                    <View style={styles.pager}>
                        <Pressable
                            disabled={pg === 0}
                            onPress={() => setPage(pg - 1)}
                            testID='gomon_call.page_prev'
                        >
                            <CompassIcon
                                name='chevron-left'
                                size={24}
                                color={pg === 0 ? 'rgba(255,255,255,0.3)' : '#fff'}
                            />
                        </Pressable>
                        <Text style={styles.pagerText}>{`${pg + 1} / ${pages}`}</Text>
                        <Pressable
                            disabled={pg >= pages - 1}
                            onPress={() => setPage(pg + 1)}
                            testID='gomon_call.page_next'
                        >
                            <CompassIcon
                                name='chevron-right'
                                size={24}
                                color={pg >= pages - 1 ? 'rgba(255,255,255,0.3)' : '#fff'}
                            />
                        </Pressable>
                    </View>
                }
            </>
        );
    } else {
        const cams = tiles.filter((t) => !t.screen);
        const speakerTile = (lastSpeaker && byKey.get(tileKey(lastSpeaker, 'camera'))) || cams.find((t) => !t.local) || cams[0] || tiles[0];
        let mainKeys = [speakerTile?.key].filter(Boolean) as string[];
        if (spotKeys.length) {
            mainKeys = spotKeys;
        } else if (pinKeys.length) {
            mainKeys = pinKeys;
        } else if (shares.length) {
            mainKeys = [shares[shares.length - 1].key];
        }
        const main = mainKeys.map((k) => byKey.get(k)!).filter(Boolean);
        const strip = tiles.filter((t) => !mainKeys.includes(t.key));
        const stripH = portrait ? 120 : 90;
        body = (
            <>
                <FitTiles
                    items={main}
                    aspectFor={aspectFor}
                    render={tile}
                />
                {strip.length > 0 &&
                    <ScrollView
                        horizontal={true}
                        style={styles.strip}
                        contentContainerStyle={styles.stripContent}
                        showsHorizontalScrollIndicator={false}
                        testID='gomon_call.strip'
                    >
                        {strip.map((t) => (
                            <React.Fragment key={t.key}>
                                {tile(t, Math.round(stripH * Math.min(aspectFor(t), 1.4)), stripH, true)}
                            </React.Fragment>
                        ))}
                    </ScrollView>
                }
            </>
        );
    }

    const fullTile = full ? byKey.get(full) : undefined;
    return (
        <View
            style={styles.stage}
            testID={`gomon_call.stage.${mode}`}
        >
            {body}
            <Modal
                visible={Boolean(fullTile)}
                onRequestClose={() => setFull(null)}
                supportedOrientations={['portrait', 'landscape']}
                statusBarTranslucent={true}
                animationType='fade'
            >
                <View style={styles.full}>
                    {fullTile?.pub &&
                        <VideoTrack
                            trackRef={{participant: fullTile.p, publication: fullTile.pub, source: fullTile.pub.source} as TrackReference}
                            style={styles.video}
                            objectFit='contain'
                        />
                    }
                    <Pressable
                        onPress={() => setFull(null)}
                        style={[styles.fullClose, {top: insets.top + 8}]}
                        accessibilityLabel={intl.formatMessage(messages.close)}
                        testID='gomon_call.fullscreen.close'
                    >
                        <CompassIcon
                            name='close'
                            size={24}
                            color='#fff'
                        />
                    </Pressable>
                </View>
            </Modal>
        </View>
    );
};

export default Stage;
