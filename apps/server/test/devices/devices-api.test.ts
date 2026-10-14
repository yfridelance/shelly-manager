import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { upsertSeenDevice } from '../../src/db/devices.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { DEFAULT_FLEET, startMockFleet, type MockFleet } from '../mock-shelly/index.js';

// 10.0.0.1-6: default fleet (see mock-shelly DEFAULT_FLEET).
let fleet: MockFleet;
const hostMap = new Map<string, string>();
beforeAll(async () => {
  fleet = await startMockFleet(DEFAULT_FLEET);
  fleet.devices.forEach((d, i) => hostMap.set(`10.0.0.${i + 1}`, d.host));
});
afterAll(async () => {
  await fleet.close();
});

let app: FastifyInstance | undefined;
let db: Db;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function makeApp(file = ':memory:'): Promise<FastifyInstance> {
  db = openDatabase(file);
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'silent' },
    db,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', adapterTimeoutMs: 1000 },
  });
  return app;
}

/** Puts mock device i (1-based) into the inventory, as a scan would. */
async function seed(i: number): Promise<string> {
  const host = hostMap.get(`10.0.0.${i}`) ?? '';
  const info = await probeShelly(host);
  upsertSeenDevice(db, info, `10.0.0.${i}`, '2026-10-14T10:00:00.000Z');
  return info.mac;
}

describe('devices API', () => {
  it('lists the inventory', async () => {
    const a = await makeApp();
    await seed(1);
    await seed(3);
    const res = await a.inject({ method: 'GET', url: '/api/devices' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({ mac: 'A8032AB12345', gen: 2, ip: '10.0.0.3', name: 'Boiler', state: 'active', authRequired: false, lastSnapshotAt: null }),
      expect.objectContaining({ mac: 'E868E7A1B2C3', gen: 1, model: 'SHSW-1', firmware: '20230913-112003/v1.14.0-gcb84623' }),
    ]);
  });

  it('accepts MACs with separators and rejects garbage', async () => {
    const a = await makeApp();
    await seed(3);
    expect((await a.inject({ method: 'GET', url: '/api/devices/a8:03:2a:b1:23:45' })).json()).toMatchObject({ device: { mac: 'A8032AB12345' } });
    expect((await a.inject({ method: 'GET', url: '/api/devices/nope' })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/api/devices/000000000000' })).statusCode).toBe(404);
  });

  it('edits name, location and notes locally', async () => {
    const a = await makeApp();
    const mac = await seed(3);
    const res = await a.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { location: ' Keller ', notes: 'Hinter dem Boiler\nSicherung F3', name: 'Warmwasser' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ location: 'Keller', notes: 'Hinter dem Boiler\nSicherung F3', name: 'Warmwasser', deviceName: 'Boiler' });

    // Partial update leaves the other fields alone; an empty name falls back to the device's name.
    const second = await a.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { name: '' } });
    expect(second.json()).toMatchObject({ name: 'Boiler', location: 'Keller' });
    const cleared = await a.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { location: null } });
    expect(cleared.json()).toMatchObject({ location: null, notes: 'Hinter dem Boiler\nSicherung F3' });
    // Nothing went to the device.
    expect(fleet.devices[2]?.state.requests.some((r) => r.startsWith('RPC'))).toBe(false);
  });

  it('rejects unknown fields and unknown devices', async () => {
    const a = await makeApp();
    const mac = await seed(3);
    expect((await a.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { ip: '1.2.3.4' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { notes: 'x'.repeat(10_001) } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'PATCH', url: '/api/devices/000000000000', payload: { notes: 'x' } })).statusCode).toBe(404);
  });

  it('keeps local edits after a restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-persist-'));
    const file = path.join(dir, 'db.sqlite');
    try {
      const first = await makeApp(file);
      const mac = await seed(1);
      await first.inject({ method: 'PATCH', url: `/api/devices/${mac}`, payload: { location: 'Waschküche', notes: 'Licht über der Maschine' } });
      await first.close();
      app = undefined;

      const second = await makeApp(file);
      const res = await second.inject({ method: 'GET', url: `/api/devices/${mac}` });
      expect(res.json()).toMatchObject({ device: { location: 'Waschküche', notes: 'Licht über der Maschine' } });
    } finally {
      await app?.close();
      app = undefined;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes a snapshot on demand, stores raw answers and logs the action', async () => {
    const a = await makeApp();
    const mac = await seed(1);
    const res = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot` });
    expect(res.statusCode).toBe(201);
    const snap = res.json<{ id: number; info: unknown; config: unknown; status: unknown }>();
    expect(snap.info).toMatchObject({ type: 'SHSW-1', longid: 1 });
    expect(snap.config).toMatchObject({ name: 'Licht Keller', relays: [{ appliance_type: 'General' }] });
    expect(snap.status).toMatchObject({ relays: [{ ison: false }] });

    const details = (await a.inject({ method: 'GET', url: `/api/devices/${mac}` })).json<{
      device: { lastSnapshotAt: string | null };
      latestSnapshot: { id: number };
      snapshots: { id: number; hasConfig: boolean }[];
    }>();
    expect(details.latestSnapshot.id).toBe(snap.id);
    expect(details.snapshots).toEqual([expect.objectContaining({ id: snap.id, hasConfig: true })]);
    expect(details.device.lastSnapshotAt).not.toBeNull();

    const byId = await a.inject({ method: 'GET', url: `/api/devices/${mac}/snapshots/${snap.id}` });
    expect(byId.json()).toEqual(snap);
    expect(listActions(db, { mac })).toMatchObject([{ action: 'snapshot', result: 'ok', error: null }]);
  });

  it('needs credentials for protected devices and logs the failure', async () => {
    const a = await makeApp();
    const mac = await seed(4); // Gen2 with digest password gen2-secret
    const without = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot` });
    expect(without.statusCode).toBe(502);
    expect(without.json()).toMatchObject({ error: 'auth_required' });

    const wrong = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot`, payload: { credentials: { password: 'falsch' } } });
    expect(wrong.json()).toMatchObject({ error: 'auth_invalid' });
    expect(wrong.body).not.toContain('falsch');

    const ok = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot`, payload: { credentials: { password: 'gen2-secret' } } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ config: { sys: { device: { name: 'Rollladen Büro' } } } });

    const log = listActions(db, { mac });
    expect(log.map((l) => [l.result, l.error_code])).toEqual([
      ['ok', null],
      ['error', 'auth_invalid'],
      ['error', 'auth_required'],
    ]);
    expect(JSON.stringify(log)).not.toContain('falsch');
    expect(JSON.stringify(log)).not.toContain('gen2-secret');
  });

  it('refuses to act when another device answers at the stored IP', async () => {
    const a = await makeApp();
    const mac = await seed(1);
    db.prepare("UPDATE devices SET ip = '10.0.0.3' WHERE mac = ?").run(mac); // now the Plus1PM lives there
    const res = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'mac_mismatch' });
    expect(fleet.devices[2]?.state.requests.filter((r) => r.startsWith('RPC'))).toEqual([]);
    expect(listActions(db, { mac })).toMatchObject([{ result: 'error', error_code: 'mac_mismatch' }]);
  });

  it('reports unreachable devices', async () => {
    const a = await makeApp();
    const mac = await seed(1);
    db.prepare("UPDATE devices SET ip = '10.0.0.99' WHERE mac = ?").run(mac);
    const res = await a.inject({ method: 'POST', url: `/api/devices/${mac}/snapshot` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'network' });
  });
});
