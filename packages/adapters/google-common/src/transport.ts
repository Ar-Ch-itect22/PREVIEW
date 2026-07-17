import { z } from 'zod';

export interface GoogleAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GoogleApiRequest<T> {
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';
  readonly parse: (value: unknown) => T;
  readonly url: string;
}

export interface GoogleApiTransport {
  request<T>(request: GoogleApiRequest<T>): Promise<T>;
}

export class GoogleApiError extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

export class GoogleTransportError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GoogleTransportError';
  }
}

export class FetchGoogleApiTransport implements GoogleApiTransport {
  readonly #fetch: typeof fetch;
  readonly #tokens: GoogleAccessTokenProvider;

  public constructor(tokens: GoogleAccessTokenProvider, fetchImplementation: typeof fetch = fetch) {
    this.#tokens = tokens;
    this.#fetch = fetchImplementation;
  }

  public async request<T>(request: GoogleApiRequest<T>): Promise<T> {
    const accessToken = await this.#tokens.getAccessToken();
    let response: Response;
    try {
      response = await this.#fetch(request.url, {
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...request.headers,
        },
        method: request.method,
      });
    } catch (error) {
      throw new GoogleTransportError('Google API transport failed before a response was received', {
        cause: error,
      });
    }
    const text = await response.text();
    const value = text.length === 0 ? null : parseJson(text);
    if (!response.ok) {
      throw new GoogleApiError(response.status, googleErrorMessage(response.status, value));
    }
    return request.parse(value);
  }
}

const googleErrorSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    status: z.string().optional(),
  }).optional(),
});

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new GoogleTransportError('Google API returned invalid JSON', { cause: error });
  }
}

function googleErrorMessage(status: number, value: unknown): string {
  const parsed = googleErrorSchema.safeParse(value);
  const reason = parsed.success
    ? parsed.data.error?.status ?? parsed.data.error?.message
    : undefined;
  return reason === undefined
    ? `Google API request failed with status ${String(status)}`
    : `Google API request failed with status ${String(status)} (${reason})`;
}
