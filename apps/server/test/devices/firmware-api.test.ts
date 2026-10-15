import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { getDevice, upsertSeenDevice } from '../../src/db/devices.js';
import type { ScanDetails } from '../../src/scan/scan-job.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from '../mock-shelly/index.js';

const GEN1: MockDeviceSpec = {
  kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller',
  updates: { stable: '20240819-074343/v1.14.1-gcb84623', beta: '20250101-000000/v1.15.0-beta1-gabc' },
};
const GEN2: MockDeviceSpec = {
  kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler',
  updates: { stable: { version: '1.5.0', buildId: '20250120-090000/1.5.0-g1a2b3c4' } },
};
const GEN4_PROTECTED: MockDeviceSpec = {
  kind: 'rpc', gen: 4, mac: '7C2C67B2B2B2', model: 'S4SW-001P16EU', app: 'S1PMG4', name: 'Garage', password: 'gen4-secret',
  updates: { beta: { version: '1.6.0-beta1', buildId: '20250301-120000/1.6.0-beta1-g5d6e7f8' } },
};
const UP_TO_DATE: MockDeviceSpec = { kind: 'rpc', gen: 3, mac: '34CDB0A1A1A1', model: 'S3SW-001X16EU', app: 'Mini1G3' };

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
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', probeTimeoutMs: 300, adapterTimeoutMs: 1000 },
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

const post = (a: FastifyInstance, url: string, payload?: Record<string, unknown>) => a.inject({ method: 'POST', url, ...(payload ? { payload } : {}) });

describe('firmware updates', () => {
  it('learns about available updates from every scan', async () => {
    const { a } = await setup(GEN1, GEN2, UP_TO_DATE);
    const scan = (await post(a, '/api/scans', { range: '10.0.0.1-10.0.0.3' })).json<{ id: string }>();
    for (let i = 0; i < 100; i++) {
      const s = (await a.inject({ method: 'GET', url: `/api/scans/${scan.id}` })).json<ScanDetails>();
      if (s.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const devices = (await a.inject({ method: 'GET', url: '/api/devices' })).json<{ mac: string; updateStable: string | null; updateBeta: string | null }[]>();
    const byMac = Object.fromEntries(devices.map((d) => [d.mac, d]));
    expect(byMac['E868E7A1B2C3']).toMatchObject({ updateStable: '20240819-074343/v1.14.1-gcb84623', updateBeta: '20250101-000000/v1.15.0-beta1-gabc' });
    expect(byMac['A8032AB12345']).toMatchObject({ updateStable: '1.5.0', updateBeta: null });
    expect(byMac['34CDB0A1A1A1']).toMatchObject({ updateStable: null, updateBeta: null });
  });

  it('checks on demand (Gen1 via /ota/check + /ota, Gen2 via Shelly.CheckForUpdate)', async () => {
    const { a, devices } = { ...(await setup(GEN1, GEN2)), devices: mocks };
    const gen1 = await post(a, '/api/devices/E868E7A1B2C3/firmware/check');
    expect(gen1.statusCode).toBe(200);
    expect(gen1.json()).toMatchObject({ stable: '20240819-074343/v1.14.1-gcb84623', beta: '20250101-000000/v1.15.0-beta1-gabc' });
    expect(devices[0]?.state.requests).toEqual(expect.arrayContaining(['GET /ota/check', 'GET /ota']));

    const gen2 = await post(a, '/api/devices/A8032AB12345/firmware/check');
    expect(gen2.json()).toMatchObject({ stable: '1.5.0', beta: null });
    expect(devices[1]?.state.requests).toContain('RPC Shelly.CheckForUpdate');
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ update_stable: '1.5.0', update_checked_at: expect.any(String) });
    // Checking is read-only and not logged.
    expect(listActions(db)).toEqual([]);
  });

  it('starts a stable update, logs from/to and the device runs the new firmware afterwards', async () => {
    const { a } = await setup(GEN2);
    const res = await post(a, '/api/devices/A8032AB12345/firmware/update', { channel: 'stable' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ version: '1.5.0' });
    expect(mocks[0]?.state.updateCount).toBe(1);
    expect(mocks[0]?.state.requests).toContain('RPC Shelly.Update');
    expect((await probeShelly(mocks[0]?.host ?? '')).firmware).toBe('20250120-090000/1.5.0-g1a2b3c4');

    const [entry] = listActions(db);
    expect(entry).toMatchObject({ action: 'firmware_update', result: 'ok' });
    expect(JSON.parse(entry?.details ?? '{}')).toEqual({ channel: 'stable', from: '20241011-114455/1.4.4-g6d2a586', to: '1.5.0' });
  });

  it('starts a Gen1 beta update via /ota?beta=true', async () => {
    const { a } = await setup(GEN1);
    const res = await post(a, '/api/devices/E868E7A1B2C3/firmware/update', { channel: 'beta' });
    expect(res.statusCode).toBe(202);
    expect(mocks[0]?.state.requests).toContain('GET /ota?beta=true');
    expect((await probeShelly(mocks[0]?.host ?? '')).firmware).toBe('20250101-000000/v1.15.0-beta1-gabc');
  });

  it('refuses when the channel offers nothing newer', async () => {
    const { a } = await setup(GEN2, UP_TO_DATE);
    const beta = await post(a, '/api/devices/A8032AB12345/firmware/update', { channel: 'beta' });
    expect(beta.statusCode).toBe(409);
    expect(beta.json()).toMatchObject({ error: 'no_update' });
    expect((await post(a, '/api/devices/34CDB0A1A1A1/firmware/update', { channel: 'stable' })).json()).toMatchObject({ error: 'no_update' });
    expect(mocks.map((m) => m.state.updateCount)).toEqual([0, 0]);
    expect(listActions(db).map((l) => [l.action, l.error_code])).toEqual([
      ['firmware_update', 'no_update'],
      ['firmware_update', 'no_update'],
    ]);
  });

  it('needs credentials on protected devices and validates the channel', async () => {
    const { a } = await setup(GEN4_PROTECTED);
    expect((await post(a, '/api/devices/7C2C67B2B2B2/firmware/check')).json()).toMatchObject({ error: 'auth_required' });
    expect((await post(a, '/api/devices/7C2C67B2B2B2/firmware/update', { channel: 'nightly' })).statusCode).toBe(400);
    const ok = await post(a, '/api/devices/7C2C67B2B2B2/firmware/update', { channel: 'beta', credentials: { password: 'gen4-secret' } });
    expect(ok.statusCode).toBe(202);
    expect(mocks[0]?.state.updateCount).toBe(1);
    expect(JSON.stringify(listActions(db))).not.toContain('gen4-secret');
  });
});
