import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JudgeSession, JudgeSessionError } from './judge-session.js';
import {
  LIVE_SANDBOX_SAMPLE_INTENT,
  LiveSandboxRunner,
  LiveSandboxUnavailableError,
  validateLiveSandboxIntent,
} from './live-sandbox.js';
import {
  LiveSandboxRateGuard,
  loadLiveSandboxRateLimitConfig,
} from './live-sandbox-rate-guard.js';

const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
});

export function createJudgeServer() {
  let session = new JudgeSession();
  const liveSandbox = new LiveSandboxRunner();
  const liveRateGuard = new LiveSandboxRateGuard(loadLiveSandboxRateLimitConfig());
  let liveRunInFlight = false;
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://preview.local');
        if (url.pathname.startsWith('/api/')) {
          if (request.method === 'GET' && url.pathname === '/api/live-sandbox') {
            writeJson(response, 200, {
              available: liveSandbox.available,
              model: 'gpt-5.6',
              providerMode: 'ISOLATED_SYNTHETIC',
              sampleIntent: LIVE_SANDBOX_SAMPLE_INTENT,
              toolAuthority: 'STAGE_ONLY',
              usageLimit: {
                clientRunsPerHour: liveRateGuard.config.clientLimit,
                globalRunsPerHour: liveRateGuard.config.globalLimit,
              },
            });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/session') {
            writeJson(response, 200, await session.view());
            return;
          }
          if (request.method !== 'POST') {
            writeJson(response, 405, { error: 'Method not allowed' });
            return;
          }
          if (url.pathname === '/api/live-sandbox/run') {
            if (liveRunInFlight) {
              writeJson(response, 409, { error: 'A Live Sandbox run is already in progress' });
              return;
            }
            const body = await readJsonBody(request);
            const intent = typeof body.intent === 'string' ? body.intent : '';
            validateLiveSandboxIntent(intent);
            const rateLimit = liveRateGuard.tryAcquire(clientIdentifier(request));
            if (!rateLimit.allowed) {
              writeJson(
                response,
                429,
                { error: 'Live Sandbox hourly limit reached; Guided Judge Mode remains available' },
                { 'Retry-After': String(rateLimit.retryAfterSeconds) },
              );
              return;
            }
            liveRunInFlight = true;
            try {
              writeJson(response, 200, await liveSandbox.run(intent));
            } finally {
              liveRunInFlight = false;
            }
            return;
          }
          switch (url.pathname) {
            case '/api/session/abort':
              writeJson(response, 200, await session.abort());
              return;
            case '/api/session/approve':
              writeJson(response, 200, await session.approve());
              return;
            case '/api/session/commit':
              writeJson(response, 200, await session.commit());
              return;
            case '/api/session/protect-acme':
              writeJson(response, 200, await session.protectAcme());
              return;
            case '/api/session/reset':
              session = new JudgeSession();
              writeJson(response, 200, await session.view());
              return;
            case '/api/session/stage':
              writeJson(response, 200, await session.stage());
              return;
            default:
              writeJson(response, 404, { error: 'Unknown Judge Mode action' });
              return;
          }
        }
        if (request.method === 'GET' && url.pathname === '/healthz') {
          writeJson(response, 200, { status: 'ok' });
          return;
        }
        await serveAsset(url.pathname, request, response);
      } catch (error) {
        const status = error instanceof JudgeSessionError
          ? 409
          : error instanceof LiveSandboxUnavailableError
            ? 400
            : 500;
        writeJson(response, status, {
          error: error instanceof Error ? error.message : 'Unknown Judge Mode error',
        });
      }
    })();
  });
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value: unknown = chunk;
    const bytes = typeof value === 'string'
      ? Buffer.from(value)
      : value instanceof Uint8Array
        ? Buffer.from(value)
        : (() => { throw new LiveSandboxUnavailableError('Unsupported request body chunk'); })();
    total += bytes.length;
    if (total > 16_384) throw new LiveSandboxUnavailableError('Request body is too large');
    chunks.push(bytes);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('Request body must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LiveSandboxUnavailableError) throw error;
    throw new LiveSandboxUnavailableError('Request body must be valid JSON');
  }
}

async function serveAsset(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end();
    return;
  }
  const asset = pathname === '/' ? 'index.html' : pathname.replace(/^\//u, '');
  if (!['app.js', 'index.html', 'styles.css'].includes(asset)) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(PUBLIC_DIRECTORY, asset);
  const details = await stat(path);
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': details.size,
    'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(path).pipe(response);
}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function clientIdentifier(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstForwarded = value?.split(',')[0]?.trim();
  if (firstForwarded !== undefined && firstForwarded.length > 0) {
    return firstForwarded.slice(0, 128);
  }
  return request.socket.remoteAddress ?? 'unknown-client';
}

export interface JudgeServerBinding {
  readonly host: '0.0.0.0' | '127.0.0.1' | 'localhost';
  readonly port: number;
}

export function loadJudgeServerBinding(
  environment: NodeJS.ProcessEnv = process.env,
): JudgeServerBinding {
  const configuredHost = environment.HOST?.trim();
  const hostValue = configuredHost === undefined || configuredHost.length === 0
    ? '127.0.0.1'
    : configuredHost;
  if (hostValue !== '0.0.0.0' && hostValue !== '127.0.0.1' && hostValue !== 'localhost') {
    throw new TypeError('HOST must be 0.0.0.0, 127.0.0.1, or localhost');
  }
  const configuredPort = environment.PORT?.trim();
  const portValue = configuredPort === undefined || configuredPort.length === 0
    ? '4173'
    : configuredPort;
  if (!/^\d+$/u.test(portValue)) throw new TypeError('PORT must be an integer from 1 to 65535');
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('PORT must be an integer from 1 to 65535');
  }
  return Object.freeze({ host: hostValue, port });
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const binding = loadJudgeServerBinding();
  createJudgeServer().listen(binding.port, binding.host, () => {
    const displayHost = binding.host === '0.0.0.0' ? '127.0.0.1' : binding.host;
    process.stdout.write(`PREVIEW Judge Mode: http://${displayHost}:${String(binding.port)}\n`);
  });
}
