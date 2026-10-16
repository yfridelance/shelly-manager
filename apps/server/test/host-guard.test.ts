import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';
import { hostnameFromHostHeader, hostnameFromOrigin, isHostAllowed, DEFAULT_ALLOWED_HOSTS } from '../src/security/host-guard.js';

describe('host parsing', () => {
  it('strips ports and normalises names', () => {
    expect(hostnameFromHostHeader('LocalHost:4200')).toBe('localhost');
    expect(hostnameFromHostHeader('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameFromHostHeader('[::1]:3000')).toBe('::1');
    expect(hostnameFromHostHeader('[::1]')).toBe('::1');
    expect(hostnameFromHostHeader('localhost.')).toBe('localhost');
  });

  it('rejects malformed Host headers', () => {
    expect(hostnameFromHostHeader(undefined)).toBeUndefined();
    expect(hostnameFromHostHeader('')).toBeUndefined();
    expect(hostnameFromHostHeader('::1')).toBeUndefined();
    expect(hostnameFromHostHeader('localhost:abc')).toBeUndefined();
    expect(hostnameFromHostHeader('[::1]x')).toBeUndefined();
  });

  it('parses Origin headers', () => {
    expect(hostnameFromOrigin('http://localhost:4200')).toBe('localhost');
    expect(hostnameFromOrigin('http://[::1]:8080')).toBe('::1');
    expect(hostnameFromOrigin('null')).toBeUndefined();
  });

  it('matches wildcards only on subdomains', () => {
    expect(isHostAllowed('app.localhost', DEFAULT_ALLOWED_HOSTS)).toBe(true);
    expect(isHostAllowed('evillocalhost', DEFAULT_ALLOWED_HOSTS)).toBe(false);
    expect(isHostAllowed('localhost.evil.example', DEFAULT_ALLOWED_HOSTS)).toBe(false);
    expect(isHostAllowed('127.0.0.1.nip.io', DEFAULT_ALLOWED_HOSTS)).toBe(false);
  });
});

describe('API host/origin guard', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-guard-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>spa</html>');
    app = await buildApp({
      config: { staticDir: dir, logLevel: 'silent', allowedHosts: ['shelly.home.lan', '*.proxy.lan'] },
      db: openDatabase(':memory:'),
    });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const health = (host: string) => app.inject({ method: 'GET', url: '/api/health', headers: { host } });

  it.each(['evil.example', 'evil.example:3000', 'localhost.evil.example', '192.168.1.10:8080'])('rejects Host %s', async (host) => {
    const res = await health(host);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'host_not_allowed' });
  });

  it.each(['localhost', 'localhost:4200', 'localhost:8080', '127.0.0.1:3000', '[::1]:3000', 'app.localhost', 'shelly.home.lan', 'x.proxy.lan:443'])(
    'allows Host %s',
    async (host) => {
      const res = await health(host);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    },
  );

  it('also guards unknown API paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(403);
  });

  it('keeps serving the SPA itself', async () => {
    const res = await app.inject({ method: 'GET', url: '/inventar', headers: { host: 'evil.example' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('<html>spa</html>');
  });

  const patchDevice = (origin?: string) =>
    app.inject({
      method: 'PATCH',
      url: '/api/devices/AABBCCDDEEFF',
      headers: { host: 'localhost:4200', ...(origin !== undefined ? { origin } : {}) },
      payload: { notes: 'x' },
    });

  it.each(['http://evil.example', 'http://localhost.evil.example:4200', 'null'])('rejects writes from Origin %s', async (origin) => {
    const res = await patchDevice(origin);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'origin_not_allowed' });
  });

  it.each([undefined, 'http://localhost:4200', 'http://127.0.0.1:8080', 'https://shelly.home.lan'])('lets writes with Origin %s through', async (origin) => {
    const res = await patchDevice(origin);
    // Passes the guard; the device does not exist.
    expect(res.statusCode).toBe(404);
  });

  it('does not check the Origin of reading requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost', origin: 'http://evil.example' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a foreign Origin on POST', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/AABBCCDDEEFF/factory-reset',
      headers: { host: 'localhost', origin: 'http://evil.example' },
      payload: { confirmMac: 'AABBCCDDEEFF' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'origin_not_allowed' });
  });
});
