// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {likeVariants, sanitizeLikeString, sqlLikeTerm} from './index';

describe('Test SQLite Sanitize like string with latin and non-latin characters', () => {
    const disallowed = ',./;[]!@#$%^&*()_-=+~';

    test('test (latin)', () => {
        expect(sanitizeLikeString('test123')).toBe('test123');
        expect(sanitizeLikeString(`test123${disallowed}`)).toBe(`test123${'_'.repeat(disallowed.length)}`);
    });

    test('test (arabic)', () => {
        expect(sanitizeLikeString('اختبار123')).toBe('اختبار123');
        expect(sanitizeLikeString(`اختبار123${disallowed}`)).toBe(`اختبار123${'_'.repeat(disallowed.length)}`);
    });

    test('test (greek)', () => {
        expect(sanitizeLikeString('δοκιμή123')).toBe('δοκιμή123');
        expect(sanitizeLikeString(`δοκιμή123${disallowed}`)).toBe(`δοκιμή123${'_'.repeat(disallowed.length)}`);
    });

    test('test (hebrew)', () => {
        expect(sanitizeLikeString('חשבון123')).toBe('חשבון123');
        expect(sanitizeLikeString(`חשבון123${disallowed}`)).toBe(`חשבון123${'_'.repeat(disallowed.length)}`);
    });

    test('test (russian)', () => {
        expect(sanitizeLikeString('тест123')).toBe('тест123');
        expect(sanitizeLikeString(`тест123${disallowed}`)).toBe(`тест123${'_'.repeat(disallowed.length)}`);
    });

    test('test (chinese trad)', () => {
        expect(sanitizeLikeString('測試123')).toBe('測試123');
        expect(sanitizeLikeString(`測試123${disallowed}`)).toBe(`測試123${'_'.repeat(disallowed.length)}`);
    });

    test('test (japanese)', () => {
        expect(sanitizeLikeString('テスト123')).toBe('テスト123');
        expect(sanitizeLikeString(`テスト123${disallowed}`)).toBe(`テスト123${'_'.repeat(disallowed.length)}`);
    });
});

describe('matras: case-insensitive LIKE for non-ASCII terms', () => {
    it('likeVariants covers the spellings people type', () => {
        expect(likeVariants('иванов')).toEqual(['иванов', 'ИВАНОВ', 'Иванов']);
        expect(likeVariants('Иванов')).toEqual(['Иванов', 'иванов', 'ИВАНОВ']);
        expect(likeVariants('town')).toEqual(['town', 'TOWN', 'Town']);
        expect(likeVariants('')).toEqual(['']);
    });

    it('sqlLikeTerm builds a prefix or contains match over every variant, sanitized', () => {
        expect(sqlLikeTerm('u.username', 'ив', true)).toBe("(u.username LIKE 'ив%' OR u.username LIKE 'ИВ%' OR u.username LIKE 'Ив%')");
        expect(sqlLikeTerm('c.display_name', "o'brien")).toBe("(c.display_name LIKE '%o_brien%' OR c.display_name LIKE '%O_BRIEN%' OR c.display_name LIKE '%O_brien%')");
    });
});
