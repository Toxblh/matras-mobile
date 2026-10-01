// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: copied from comms apps/meeting-web/src/extensions/conf/fit.test.ts (comms dc0ae61); keep in sync until
// the shared comms-core package (phase 4). Only the code style differs.

import {aspectOf, fitRows} from './fit';

describe('fitRows', () => {
    it('a portrait video on a landscape stage is shown whole, full height', () => {
        const [row] = fitRows(1600, 900, [9 / 16], 10);
        expect(row.items).toEqual([0]);
        expect(row.height).toBe(900);
    });
    it('two landscape videos on a phone in portrait go one above the other', () => {
        const rows = fitRows(390, 700, [16 / 9, 16 / 9], 8);
        expect(rows.map((r) => r.items)).toEqual([[0], [1]]);
    });
    it('two landscape videos on a wide screen go side by side', () => {
        const rows = fitRows(1600, 700, [16 / 9, 16 / 9], 8);
        expect(rows.map((r) => r.items)).toEqual([[0, 1]]);
    });
    it('never overflows the stage', () => {
        for (const n of [1, 2, 3, 5, 9]) {
            const aspects = Array.from({length: n}, (_, i) => (i % 2 ? 9 / 16 : 16 / 9));
            const rows = fitRows(1000, 600, aspects, 10);
            expect(rows.flatMap((r) => r.items)).toEqual(aspects.map((_, i) => i));
            expect(rows.reduce((s, r) => s + r.height, 0) + (10 * (rows.length - 1))).toBeLessThanOrEqual(600);
            for (const r of rows) {
                expect(r.items.reduce((s, i) => s + (r.height * aspects[i]), 0) + (10 * (r.items.length - 1))).toBeLessThanOrEqual(1000 + 1);
            }
        }
    });
    it('aspect falls back to 16:9 without video', () => {
        expect(aspectOf(null)).toBeCloseTo(16 / 9);
        expect(aspectOf({width: 720, height: 1280})).toBeCloseTo(0.5625);
    });
});
