import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JudgeSession, JudgeSessionError } from './judge-session.js';

const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
});

export function createJudgeServer() {
  let session = new JudgeSession();
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://preview.local');
        if (url.pathname.startsWith('/api/')) {
          if (request.method === 'GET' && url.pathname === '/api/session') {
            writeJson(response, 200, await session.view());
            return;
          }
          if (request.method !== 'POST') {
            writeJson(response, 405, { error: 'Method not allowed' });
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
        await serveAsset(url.pathname, request, response);
      } catch (error) {
        const status = error instanceof JudgeSessionError ? 409 : 500;
        writeJson(response, status, {
          error: error instanceof Error ? error.message : 'Unknown Judge Mode error',
        });
      }
    })();
  });
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

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
}

const isMain = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '4173', 10);
  createJudgeServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`PREVIEW Judge Mode: http://127.0.0.1:${String(port)}\n`);
  });
}
