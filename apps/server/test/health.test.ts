import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';

describe('GET /api/health', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('answers 200 { status: "ok" }', async () => {
    app = await buildApp({ config: { staticDir: undefined, logLevel: 'silent' }, db: openDatabase(':memory:') });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('answers unknown API routes with a JSON 404', async () => {
    app = await buildApp({ config: { staticDir: undefined, logLevel: 'silent' }, db: openDatabase(':memory:') });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Not Found' });
  });
});
