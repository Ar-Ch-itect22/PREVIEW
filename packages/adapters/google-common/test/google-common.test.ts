import { describe, expect, it, vi } from 'vitest';

import {
  FetchGoogleApiTransport,
  GoogleApiError,
  GoogleRefreshTokenProvider,
} from '../src/index.js';

describe('Google credential and HTTP boundary', () => {
  it('uses a bearer token without placing it in returned values or errors', async () => {
    const secret = 'not-a-real-access-token';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { status: 'PERMISSION_DENIED' },
    }), { status: 403 }));
    const transport = new FetchGoogleApiTransport({ getAccessToken: () => Promise.resolve(secret) }, fetchMock);
    await expect(transport.request({
      method: 'GET',
      parse: (value) => value,
      url: 'https://example.test/resource',
    })).rejects.toBeInstanceOf(GoogleApiError);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
    try {
      await transport.request({ method: 'GET', parse: (value) => value, url: 'https://example.test/resource' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('exchanges a refresh token once and reuses the short-lived access-token cache', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'short-lived-access',
      expires_in: 3600,
      token_type: 'Bearer',
    }), { status: 200 }));
    const provider = new GoogleRefreshTokenProvider({
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
      refreshToken: 'synthetic-refresh',
    }, fetchMock);
    expect(await provider.getAccessToken()).toBe('short-lived-access');
    expect(await provider.getAccessToken()).toBe('short-lived-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(body instanceof URLSearchParams ? body.get('grant_type') : undefined).toBe('refresh_token');
  });
});
