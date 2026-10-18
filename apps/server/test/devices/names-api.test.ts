import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { getDevice, upsertSeenDevice } from '../../src/db/devices.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from '../mock-shelly/index.js';

// Floor, writing the name to the device (POST /devices/:mac/name) and the template field device.name.

const GEN1_OPEN: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };
const GEN1_PROTECTED: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7D4E5F6', type: 'SHSW-25', name: 'Storen', auth: { username: 'admin', password: 'gen1-secret' } };
const GEN2_OPEN: MockDeviceSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
const GEN4_PROTECTED: MockDeviceSpec = { kind: 'rpc', gen: 4, mac: '7C2C67B2B2B2', model: 'S4SW-001P16EU', app: 'S1PMG4', name: 'Garage', password: 'gen4-secret' };

let app: FastifyInstance | undefined;
let db: Db;
let mocks: MockDevice[] = [];
const hostMap = new Map<string, string>();

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(mocks.map((m) => m.stop()));
  mocks = [];
  hostMap.clear();
});

async function setup(...specs: MockDeviceSpec[]): Promise<{ a: FastifyInstance; macs: string[] }> {
  db = openDatabase(':memory:');
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'silent' },
    db,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', adapterTimeoutMs: 1000 },
  });
  mocks = await Promise.all(specs.map((s) => startMockDevice(s)));
  const macs: string[] = [];
  for (const [i, m] of mocks.entries()) {
    hostMap.set(`10.0.0.${i + 1}`, m.host);
    const info = await probeShelly(m.host);
    upsertSeenDevice(db, info, `10.0.0.${i + 1}`, '2026-10-14T10:00:00.000Z');
    macs.push(info.mac);
  }
  return { a: app, macs };
}

const send = (a: FastifyInstance, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  a.inject({ method, url, ...(payload ? { payload } : {}) });

const reportedName = async (m: MockDevice | undefined) => (await probeShelly(m?.host ?? '')).name;
/** Gen1 reports its name only in /settings. */
const gen1Name = async (m: MockDevice | undefined) => ((await (await fetch(`http://${m?.host}/settings`)).json()) as { name: string | null }).name;

describe('floor', () => {
  it('is a local field like location and kind, kept by scans', async () => {
    const { a, macs } = await setup(GEN2_OPEN);
    const res = await send(a, 'PATCH', `/api/devices/${macs[0]}`, { floor: ' 1. OG ' });
    expect(res.json()).toMatchObject({ floor: '1. OG' });
    upsertSeenDevice(db, await probeShelly(mocks[0]?.host ?? ''), '10.0.0.9', '2026-10-15T10:00:00.000Z');
    expect(getDevice(db, macs[0] ?? '')?.floor).toBe('1. OG');
    expect((await send(a, 'PATCH', `/api/devices/${macs[0]}`, { floor: '' })).json()).toMatchObject({ floor: null });
    expect((await send(a, 'PATCH', `/api/devices/${macs[0]}`, { floor: 'x'.repeat(51) })).statusCode).toBe(400);
  });
});

describe('writing the name to the device', () => {
  it('renames a Gen2 device, makes local and device name equal and logs from/to', async () => {
    const { a, macs } = await setup(GEN2_OPEN);
    await send(a, 'PATCH', `/api/devices/${macs[0]}`, { name: 'EG Küche Licht' });
    const res = await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: ' EG  Küche Licht ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'EG Küche Licht', snapshotId: expect.any(Number) });
    expect(await reportedName(mocks[0])).toBe('EG Küche Licht');
    expect(getDevice(db, macs[0] ?? '')).toMatchObject({ name: 'EG Küche Licht', device_name: 'EG Küche Licht' });

    const log = listActions(db).find((l) => l.action === 'rename');
    expect(log?.result).toBe('ok');
    expect(JSON.parse(log?.details ?? '{}')).toMatchObject({ from: 'Boiler', to: 'EG Küche Licht', snapshotAfterId: expect.any(Number) });
    expect(mocks[0]?.state.requests).toContain('RPC Sys.SetConfig');

    // Local and device name are equal again: a rename on the device is followed by the next scan.
    upsertSeenDevice(db, { ...(await probeShelly(mocks[0]?.host ?? '')), name: 'Am Gerät umbenannt' }, '10.0.0.1', '2026-10-15T10:00:00.000Z');
    expect(getDevice(db, macs[0] ?? '')?.name).toBe('Am Gerät umbenannt');
  });

  it('renames a Gen1 device via /settings?name=', async () => {
    const { a, macs } = await setup(GEN1_OPEN);
    const res = await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Keller Licht' });
    expect(res.statusCode).toBe(200);
    expect(await gen1Name(mocks[0])).toBe('Keller Licht');
  });

  it('needs credentials for protected devices and only sends them there', async () => {
    const { a, macs } = await setup(GEN4_PROTECTED, GEN1_PROTECTED);
    expect((await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Garage Tor' })).json()).toMatchObject({ error: 'auth_required' });
    const ok = await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Garage Tor', credentials: { password: 'gen4-secret' } });
    expect(ok.statusCode).toBe(200);
    expect(await reportedName(mocks[0])).toBe('Garage Tor');
    const gen1 = await send(a, 'POST', `/api/devices/${macs[1]}/name`, { name: 'OG Storen', credentials: { username: 'admin', password: 'gen1-secret' } });
    expect(gen1.statusCode).toBe(200);
  });

  it('refuses empty or too long names before contacting the device', async () => {
    const { a, macs } = await setup(GEN1_OPEN, GEN2_OPEN);
    const before = mocks[0]?.state.requests.length;
    expect((await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: '   ' })).json()).toMatchObject({ error: 'invalid_name' });
    const long = await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'x'.repeat(31) });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toMatchObject({ error: 'invalid_name' });
    expect(mocks[0]?.state.requests.length).toBe(before);
    // Gen2+ allows longer names than Gen1.
    expect((await send(a, 'POST', `/api/devices/${macs[1]}/name`, { name: 'x'.repeat(31) })).statusCode).toBe(200);
  });

  it('never renames a different device that now holds the IP', async () => {
    const { a, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    db.prepare("UPDATE devices SET ip = '10.0.0.2' WHERE mac = ?").run(macs[0]);
    const res = await send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Falsch' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'mac_mismatch' });
    expect(await gen1Name(mocks[1])).toBe('Licht Keller');
  });

  it('runs only one action per device at a time', async () => {
    const { a, macs } = await setup({ ...GEN2_OPEN, delayMs: 150 });
    const [first, second] = await Promise.all([
      send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Eins' }),
      send(a, 'POST', `/api/devices/${macs[0]}/name`, { name: 'Zwei' }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect([first.json(), second.json()]).toContainEqual(expect.objectContaining({ error: 'busy' }));
  });
});

describe('template field device.name', () => {
  it('builds the name from floor, location and kind, previews and writes it', async () => {
    const { a, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    await send(a, 'PATCH', `/api/devices/${macs[0]}`, { floor: 'EG', location: 'Küche', kind: 'Licht' });
    await send(a, 'PATCH', `/api/devices/${macs[1]}`, { location: 'Keller', kind: 'Licht' }); // no floor: collapses
    for (const mac of macs) await send(a, 'POST', `/api/devices/${mac}/snapshot`);
    const created = await send(a, 'POST', '/api/templates', { name: 'Namen', settings: { device: { name: '{floor} {location} {kind}' } } });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;

    const preview = (await send(a, 'POST', `/api/templates/${id}/preview`, {})).json<{ mac: string; items: unknown[] }[]>();
    expect(Object.fromEntries(preview.map((p) => [p.mac, p.items]))).toEqual({
      [macs[0] ?? '']: [{ key: 'device.name', status: 'change', current: 'Boiler', target: 'EG Küche Licht' }],
      [macs[1] ?? '']: [{ key: 'device.name', status: 'change', current: 'Licht Keller', target: 'Keller Licht' }],
    });

    for (const mac of macs) {
      const res = await send(a, 'POST', `/api/devices/${mac}/apply-template`, { templateId: id });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ changed: 1 });
    }
    expect(await reportedName(mocks[0])).toBe('EG Küche Licht');
    expect(getDevice(db, macs[0] ?? '')).toMatchObject({ name: 'EG Küche Licht', device_name: 'EG Küche Licht' });
    expect(getDevice(db, macs[1] ?? '')).toMatchObject({ name: 'Keller Licht', device_name: 'Keller Licht' });

    // Applied again: nothing left to do.
    const again = await send(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(again.json()).toMatchObject({ changed: 0 });
  });

  it('reports empty or too long names as unsupported and sends nothing', async () => {
    const { a, macs } = await setup(GEN1_OPEN);
    await send(a, 'POST', `/api/devices/${macs[0]}/snapshot`);
    const empty = (await send(a, 'POST', '/api/templates', { name: 'Leer', settings: { device: { name: '{floor} {kind}' } } })).json<{ id: number }>();
    const long = (await send(a, 'POST', '/api/templates', { name: 'Lang', settings: { device: { name: `{name} ${'x'.repeat(30)}` } } })).json<{ id: number }>();
    const r1 = await send(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: empty.id });
    expect(r1.json()).toMatchObject({ changed: 0, items: [{ key: 'device.name', status: 'unsupported', reason: 'name_empty' }] });
    const r2 = await send(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: long.id });
    expect(r2.json()).toMatchObject({ changed: 0, items: [{ key: 'device.name', status: 'unsupported', reason: 'name_too_long' }] });
    expect(mocks[0]?.state.requests.some((r) => r.includes('name='))).toBe(false);
    expect(await gen1Name(mocks[0])).toBe('Licht Keller');
  });
});
