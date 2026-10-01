// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {GomonApi, parseJoinUrl} from './api';

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

describe('GomonApi', () => {
    const fetchMock = jest.fn();
    beforeEach(() => {
        global.fetch = fetchMock;
        fetchMock.mockReset();
    });

    it('redeems without auth, then joins with the bearer token and an idempotency key', async () => {
        const api = new GomonApi('https://g');
        fetchMock.mockResolvedValue({ok: true, json: () => Promise.resolve({token: 't'})});
        await api.redeem('code');
        expect(fetchMock).toHaveBeenLastCalledWith('https://g/v1/handoff/redeem', expect.objectContaining({headers: {'Content-Type': 'application/json'}, body: '{"code":"code"}'}));

        await api.join('c 1', 'dev');
        const [url, init] = fetchMock.mock.calls[1];
        expect(url).toBe('https://g/v1/calls/c%201/join');
        expect(init.headers.Authorization).toBe('Bearer t');
        expect(JSON.parse(init.body)).toEqual({idempotency_key: expect.any(String), device_id: 'dev'});
    });

    it('throws the server code and message on errors', async () => {
        fetchMock.mockResolvedValue({ok: false, status: 409, json: () => Promise.resolve({error: {code: 'invalid_transition', message: 'call ended'}})});
        await expect(new GomonApi('https://g', 't').join('c', 'dev')).rejects.toMatchObject({status: 409, code: 'invalid_transition', message: 'call ended'});
    });

    it('a network failure is status 0', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        await expect(new GomonApi('https://g', 't').call('c')).rejects.toMatchObject({status: 0, code: 'network'});
    });
});
