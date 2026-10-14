import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { getDevice, upsertSeenDevice } from '../../src/db/devices.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from '../mock-shelly/index.js';

const GEN1_OPEN: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };
const GEN1_PROTECTED: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7D4E5F6', type: 'SHSW-25', name: 'Storen', auth: { username: 'admin', password: 'gen1-secret' } };
const GEN2_OPEN: MockDeviceSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
const GEN4_PROTECTED: MockDeviceSpec = { kind: 'rpc', gen: 4, mac: '7C2C67B2B2B2', model: 'S4SW-001P16EU', app: 'S1PMG4', name: 'Garage', password: 'gen4-secret' };

let app: FastifyInstance | undefined;
let db: Db;
let mocks: MockDevice[] = [];
let logLines: string[] = [];
const hostMap = new Map<string, string>();

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(mocks.map((m) => m.stop()));
  mocks = [];
  hostMap.clear();
});

/** Starts mock devices at 10.0.0.1, .2, ... and puts them into the inventory. */
async function setup(...specs: MockDeviceSpec[]): Promise<{ app: FastifyInstance; devices: MockDevice[]; macs: string[] }> {
  db = openDatabase(':memory:');
  logLines = [];
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'trace' },
    db,
    logStream: { write: (msg) => logLines.push(msg) },
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', adapterTimeoutMs: 1000 },
  });
  mocks = await Promise.all(specs.map((s) => startMockDevice(s)));
  const macs: string[] = [];
  for (const [i, m] of mocks.entries()) {
    const ip = `10.0.0.${i + 1}`;
    hostMap.set(ip, m.host);
    const info = await probeShelly(m.host);
    upsertSeenDevice(db, info, ip, '2026-10-14T10:00:00.000Z');
    macs.push(info.mac);
  }
  return { app, devices: mocks, macs };
}

const post = (a: FastifyInstance, url: string, payload?: Record<string, unknown>) =>
  a.inject({ method: 'POST', url, ...(payload ? { payload } : {}) });

describe('reboot', () => {
  it('reboots one device and logs it', async () => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN);
    const res = await post(a, `/api/devices/${macs[0]}/reboot`);
    expect(res.statusCode).toBe(202);
    expect(devices[0]?.state.rebootCount).toBe(1);
    expect(listActions(db)).toMatchObject([{ action: 'reboot', result: 'ok', requested_by: '127.0.0.1' }]);
  });

  it('needs credentials for protected devices', async () => {
    const { app: a, devices, macs } = await setup(GEN1_PROTECTED);
    expect((await post(a, `/api/devices/${macs[0]}/reboot`)).json()).toMatchObject({ error: 'auth_required' });
    const ok = await post(a, `/api/devices/${macs[0]}/reboot`, { credentials: { username: 'admin', password: 'gen1-secret' } });
    expect(ok.statusCode).toBe(202);
    expect(devices[0]?.state.rebootCount).toBe(1);
  });
});

describe('factory reset safety rules (AGENTS.md section 9)', () => {
  it('refuses without confirmMac', async () => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN);
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, {});
    expect(res.statusCode).toBe(400);
    expect(devices[0]?.state.factoryResetCount).toBe(0);
    expect(devices[0]?.state.requests).toEqual(['GET /shelly']); // only the setup probe
  });

  it.each(['A8032AB12346', 'Boiler', '', '*', 'A8032AB1234'])('refuses a wrong confirmMac %j and logs the attempt', async (confirmMac) => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN);
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac });
    expect(res.statusCode).toBe(400);
    expect(devices[0]?.state.factoryResetCount).toBe(0);
    expect(getDevice(db, 'A8032AB12345')?.state).toBe('active');
    if (confirmMac !== '') {
      expect(listActions(db)).toMatchObject([{ action: 'factory_reset', result: 'error', error_code: 'confirm_mismatch' }]);
    }
  });

  it('does not offer any way to reset several devices at once', async () => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    expect((await post(a, '/api/devices/factory-reset', { confirmMac: macs[0] })).statusCode).toBe(404);
    expect((await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs })).statusCode).toBe(400);
    expect((await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0], macs })).statusCode).toBe(400);
    expect(devices.map((d) => d.state.factoryResetCount)).toEqual([0, 0]);
  });

  it('takes a snapshot first, resets, and keeps the record as "reset"', async () => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    db.prepare("UPDATE devices SET location = 'Keller', notes = 'Boiler' WHERE mac = ?").run(macs[0]);
    // Separators and lowercase are fine.
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: 'a8:03:2a:b1:23:45' });
    expect(res.statusCode).toBe(202);
    const { snapshotId } = res.json<{ snapshotId: number }>();
    expect(snapshotId).toBeGreaterThan(0);

    expect(devices[0]?.state.factoryResetCount).toBe(1);
    expect(devices[1]?.state.factoryResetCount).toBe(0);
    // Snapshot was read before the reset command.
    const requests = devices[0]?.state.requests ?? [];
    expect(requests.indexOf('RPC Shelly.GetConfig')).toBeLessThan(requests.indexOf('RPC Shelly.FactoryReset'));

    const snap = db.prepare('SELECT config_json FROM config_snapshots WHERE id = ?').pluck().get(snapshotId) as string;
    expect(JSON.parse(snap)).toMatchObject({ sys: { device: { name: 'Boiler' } }, wifi: { sta: { ssid: 'Haus' } } });
    expect(getDevice(db, macs[0] ?? '')).toMatchObject({ state: 'reset', location: 'Keller', notes: 'Boiler' });

    const log = listActions(db);
    // The reset is listed above the snapshot it triggered.
    expect(log.map((l) => [l.action, l.result])).toEqual([
      ['factory_reset', 'ok'],
      ['snapshot', 'ok'],
    ]);
    expect(JSON.parse(log.find((l) => l.action === 'factory_reset')?.details ?? '{}')).toEqual({ snapshotId });
  });

  it('blocks the reset when the snapshot fails', async () => {
    const { app: a, devices, macs } = await setup({ ...GEN2_OPEN, failing: ['Shelly.GetStatus'] });
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'snapshot_failed', cause: 'rpc' });
    expect(devices[0]?.state.factoryResetCount).toBe(0);
    expect(getDevice(db, macs[0] ?? '')?.state).toBe('active');
    expect(listActions(db).map((l) => [l.action, l.error_code])).toEqual([
      ['factory_reset', 'snapshot_failed'],
      ['snapshot', 'rpc'],
    ]);
  });

  it('resets without snapshot only with the explicit override, and records it', async () => {
    const { app: a, devices, macs } = await setup({ ...GEN1_OPEN, failing: ['/status'] });
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0], allowWithoutSnapshot: true });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ snapshotId: null });
    expect(devices[0]?.state.factoryResetCount).toBe(1);
    expect(devices[0]?.state.requests).toContain('GET /settings?reset=true');
    const reset = listActions(db).find((l) => l.action === 'factory_reset');
    expect(reset?.result).toBe('ok');
    expect(JSON.parse(reset?.details ?? '{}')).toEqual({ snapshotError: 'http', snapshotSkipped: true });
  });

  it('never resets a different device that now holds the IP', async () => {
    const { app: a, devices, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    db.prepare("UPDATE devices SET ip = '10.0.0.2' WHERE mac = ?").run(macs[0]); // stale IP: Gen1 lives there now
    const res = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0], allowWithoutSnapshot: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'mac_mismatch' });
    expect(devices.map((d) => d.state.factoryResetCount)).toEqual([0, 0]);
  });

  it('uses credentials for protected devices and never stores or logs them', async () => {
    const { app: a, devices, macs } = await setup(GEN4_PROTECTED);
    const wrong = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0], credentials: { password: 'falsch-123' } });
    expect(wrong.json()).toMatchObject({ error: 'snapshot_failed', cause: 'auth_invalid' });
    const ok = await post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0], credentials: { password: 'gen4-secret' } });
    expect(ok.statusCode).toBe(202);
    expect(devices[0]?.state.factoryResetCount).toBe(1);

    const everything = [
      JSON.stringify(listActions(db)),
      JSON.stringify(db.prepare('SELECT * FROM config_snapshots').all()),
      JSON.stringify(db.prepare('SELECT * FROM devices').all()),
      logLines.join('\n'),
    ].join('\n');
    expect(everything).not.toContain('gen4-secret');
    expect(everything).not.toContain('falsch-123');
  });

  it('runs only one action per device at a time', async () => {
    const { app: a, devices, macs } = await setup({ ...GEN2_OPEN, delayMs: 150 });
    const [first, second] = await Promise.all([
      post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0] }),
      post(a, `/api/devices/${macs[0]}/factory-reset`, { confirmMac: macs[0] }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([202, 409]);
    expect([first.json(), second.json()]).toContainEqual(expect.objectContaining({ error: 'busy' }));
    expect(devices[0]?.state.factoryResetCount).toBe(1);
  });
});

describe('GET /api/actions', () => {
  it('lists the log newest first with device names, filterable by MAC', async () => {
    const { app: a, macs } = await setup(GEN2_OPEN, GEN1_OPEN);
    // Gen1 reports its name only via /settings, so the snapshot fills it in.
    await post(a, `/api/devices/${macs[1]}/snapshot`);
    await post(a, `/api/devices/${macs[0]}/reboot`);
    const all = (await a.inject({ method: 'GET', url: '/api/actions' })).json<{ action: string; deviceName: string }[]>();
    expect(all.map((x) => [x.action, x.deviceName])).toEqual([
      ['reboot', 'Boiler'],
      ['snapshot', 'Licht Keller'],
    ]);
    const one = (await a.inject({ method: 'GET', url: '/api/actions?mac=e8:68:e7:a1:b2:c3' })).json<unknown[]>();
    expect(one).toHaveLength(1);
    expect((await a.inject({ method: 'GET', url: '/api/actions?mac=xyz' })).statusCode).toBe(400);
  });
});
