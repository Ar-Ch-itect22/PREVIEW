import { z } from 'zod';

import {
  GoogleTransportError,
  type GoogleAccessTokenProvider,
} from './transport.js';

export interface GoogleOAuthClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().min(1),
});

export class GoogleRefreshTokenProvider implements GoogleAccessTokenProvider {
  readonly #credentials: GoogleOAuthClientCredentials;
  readonly #fetch: typeof fetch;
  #cached: { readonly accessToken: string; readonly expiresAt: number } | undefined;

  public constructor(
    credentials: GoogleOAuthClientCredentials,
    fetchImplementation: typeof fetch = fetch,
  ) {
    this.#credentials = Object.freeze({ ...credentials });
    this.#fetch = fetchImplementation;
  }

  public async getAccessToken(): Promise<string> {
    if (this.#cached !== undefined && this.#cached.expiresAt - 60_000 > Date.now()) {
      return this.#cached.accessToken;
    }
    let response: Response;
    try {
      response = await this.#fetch('https://oauth2.googleapis.com/token', {
        body: new URLSearchParams({
          client_id: this.#credentials.clientId,
          client_secret: this.#credentials.clientSecret,
          grant_type: 'refresh_token',
          refresh_token: this.#credentials.refreshToken,
        }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      });
    } catch (error) {
      throw new GoogleTransportError('Google OAuth token exchange failed before a response', {
        cause: error,
      });
    }
    const value: unknown = await response.json();
    if (!response.ok) {
      throw new GoogleTransportError(`Google OAuth token exchange failed with status ${String(response.status)}`);
    }
    const parsed = tokenResponseSchema.parse(value);
    this.#cached = {
      accessToken: parsed.access_token,
      expiresAt: Date.now() + parsed.expires_in * 1_000,
    };
    return parsed.access_token;
  }
}
