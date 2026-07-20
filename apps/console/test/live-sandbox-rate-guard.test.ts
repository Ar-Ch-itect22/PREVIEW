import { describe, expect, it } from 'vitest';

import {
  LiveSandboxRateGuard,
  loadLiveSandboxRateLimitConfig,
} from '../src/live-sandbox-rate-guard.js';
import { createJudgeServer, loadJudgeServerBinding } from '../src/server.js';

describe('public Live Sandbox deployment guards', () => {
  it('enforces per-client and global hourly limits', () => {
    let now = 1_000;
    const guard = new LiveSandboxRateGuard({
      clientLimit: 2,
      globalLimit: 3,
      now: () => now,
      windowMs: 60_000,
    });

    expect(guard.tryAcquire('judge-a')).toEqual({ allowed: true });
    expect(guard.tryAcquire('judge-a')).toEqual({ allowed: true });
    expect(guard.tryAcquire('judge-a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(guard.tryAcquire('judge-b')).toEqual({ allowed: true });
    expect(guard.tryAcquire('judge-c')).toEqual({ allowed: false, retryAfterSeconds: 60 });

    now += 60_001;
    expect(guard.tryAcquire('judge-a')).toEqual({ allowed: true });
  });

  it('loads fail-closed limits and preserves localhost defaults with explicit Render binding', () => {
    expect(loadLiveSandboxRateLimitConfig({})).toEqual({
      clientLimit: 3,
      globalLimit: 24,
      windowMs: 3_600_000,
    });
    expect(() => loadLiveSandboxRateLimitConfig({
      PREVIEW_LIVE_SANDBOX_CLIENT_LIMIT: '0',
    })).toThrow('positive integer');
    expect(loadJudgeServerBinding({})).toEqual({ host: '127.0.0.1', port: 4173 });
    expect(loadJudgeServerBinding({ HOST: '0.0.0.0', PORT: '10000' })).toEqual({
      host: '0.0.0.0',
      port: 10_000,
    });
    expect(() => loadJudgeServerBinding({ PORT: '4173oops' })).toThrow('PORT');
  });

  it('serves the deployment health check without invoking the Live Sandbox', async () => {
    const server = createJudgeServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Missing test server address');
      const response = await fetch(`http://127.0.0.1:${String(address.port)}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    }
  });
});
