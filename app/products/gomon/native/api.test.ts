// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {joinCall, parseJoinUrl, redeemHandoff} from './api';

describe('parseJoinUrl', () => {
    it('splits a plugin join url', () => {
        expect(parseJoinUrl('https://Gomon.example.ru/call/c-1?embed=rn#code=ab12cd')).toEqual({origin: 'https://gomon.example.ru', callId: 'c-1', code: 'ab12cd'});
    });

    it('rejects urls without a call or a code', () => {
        expect(parseJoinUrl('https://gomon.example.ru/call/c-1')).toBeUndefined();
        expect(parseJoinUrl('https://gomon.example.ru/meet#code=ab')).toBeUndefined();
        expect(parseJoinUrl('not a url')).toBeUndefined();
    });
});

describe('requests', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        global.fetch = fetchMock;
        fetchMock.mockReset();
    });

    it('redeems without auth and joins with the bearer token and an idempotency key', async () => {
        fetchMock.mockResolvedValue({ok: true, json: () => Promise.resolve({token: 't'})});
        await redeemHandoff('https://g', 'code');
        expect(fetchMock).toHaveBeenLastCalledWith('https://g/v1/handoff/redeem', expect.objectContaining({headers: {'Content-Type': 'application/json'}, body: '{"code":"code"}'}));

        await joinCall('https://g', 'tok', 'c 1', 'dev');
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('https://g/v1/calls/c%201/join');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body)).toEqual({idempotency_key: expect.any(String), device_id: 'dev'});
    });

    it('throws the server message on errors', async () => {
        fetchMock.mockResolvedValue({ok: false, status: 409, json: () => Promise.resolve({error: {code: 'conflict', message: 'call ended'}})});
        await expect(joinCall('https://g', 'tok', 'c', 'dev')).rejects.toThrow('call ended');
    });
});
