import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';

describe('static SPA hosting', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-static-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>spa</html>');
    fs.writeFileSync(path.join(dir, 'main.js'), 'console.log(1)');
    app = await buildApp({ config: { staticDir: dir, logLevel: 'silent' }, db: openDatabase(':memory:') });
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves bundle files', async () => {
    const res = await app.inject({ method: 'GET', url: '/main.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
  });

  it('falls back to index.html for unknown non-API paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/inventar/AABBCCDDEEFF' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toBe('<html>spa</html>');
  });

  it('does not fall back for unknown API paths', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Not Found' });
  });

  it('still serves the API', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
