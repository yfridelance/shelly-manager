import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { getDevice } from '../../src/db/devices.js';
import type { ScanDetails, ScanSummary } from '../../src/scan/scan-job.js';
import type { ScanOptions } from '../../src/scan/scan-manager.js';
import { DEFAULT_FLEET, startMockDevice, startMockFleet, type MockDevice, type MockFleet } from '../mock-shelly/index.js';

// IPs 10.0.0.1-6 are the default fleet, .7 never answers, .8 is a router, everything else refuses connections.
let fleet: MockFleet;
let hang: MockDevice;
let foreign: MockDevice;
let closedHost: string;
let hostMap: Map<string, string>;

beforeAll(async () => {
  fleet = await startMockFleet(DEFAULT_FLEET);
  hang = await startMockDevice({ kind: 'hang' });
  foreign = await startMockDevice({ kind: 'foreign' });
  const closed = await startMockDevice({ kind: 'foreign' });
  await closed.stop();
  closedHost = closed.host;
  hostMap = new Map(fleet.devices.map((d, i) => [`10.0.0.${i + 1}`, d.host]));
  hostMap.set('10.0.0.7', hang.host);
  hostMap.set('10.0.0.8', foreign.host);
});

afterAll(async () => {
  await fleet.close();
  await hang.stop();
  await foreign.stop();
});

let app: FastifyInstance | undefined;
let db: Db;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function makeApp(scan: Partial<ScanOptions> = {}, logStream?: { write(msg: string): void }, logLevel: 'silent' | 'trace' = 'silent') {
  db = openDatabase(':memory:');
  app = await buildApp({
    config: { staticDir: undefined, logLevel },
    db,
    logStream,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? closedHost, probeTimeoutMs: 300, adapterTimeoutMs: 2000, ...scan },
  });
  return app;
}

async function startScan(a: FastifyInstance, body: Record<string, unknown>): Promise<ScanSummary> {
  const res = await a.inject({ method: 'POST', url: '/api/scans', payload: body });
  expect(res.statusCode).toBe(202);
  return res.json<ScanSummary>();
}

async function waitFor(a: FastifyInstance, id: string): Promise<ScanDetails> {
  for (let i = 0; i < 200; i++) {
    const details = (await a.inject({ method: 'GET', url: `/api/scans/${id}` })).json<ScanDetails>();
    if (details.status !== 'running') return details;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('scan did not finish');
}

describe('scan API against the mock fleet', () => {
  it('finds every Shelly, skips timeouts and foreign servers, and stores open devices with snapshots', async () => {
    const a = await makeApp();
    const started = Date.now();
    const scan = await startScan(a, { range: '10.0.0.0/28' });
    expect(scan).toMatchObject({ status: 'running', total: 14, withCredentials: false });

    const done = await waitFor(a, scan.id);
    expect(Date.now() - started).toBeLessThan(3000); // the hanging host only costs one probe timeout
    expect(done).toMatchObject({ status: 'done', total: 14, scanned: 14, found: 6, errors: 0 });

    const byIp = Object.fromEntries(done.devices.map((d) => [d.ip, d]));
    expect(byIp['10.0.0.1']).toMatchObject({ mac: 'E868E7A1B2C3', gen: 1, name: 'Licht Keller', snapshot: 'ok', created: true });
    expect(byIp['10.0.0.2']).toMatchObject({ mac: 'E868E7D4E5F6', gen: 1, authRequired: true, snapshot: 'auth_required', name: null });
    expect(byIp['10.0.0.3']).toMatchObject({ mac: 'A8032AB12345', gen: 2, name: 'Boiler', snapshot: 'ok' });
    expect(byIp['10.0.0.4']).toMatchObject({ gen: 2, authRequired: true, snapshot: 'auth_required' });
    expect(byIp['10.0.0.5']).toMatchObject({ gen: 3, name: null, snapshot: 'ok' });
    expect(byIp['10.0.0.6']).toMatchObject({ gen: 4, authRequired: true, snapshot: 'auth_required' });

    expect(getDevice(db, 'E868E7D4E5F6')).toMatchObject({ ip: '10.0.0.2', gen: 1, model: 'SHSW-25', auth_required: 1, state: 'active', device_id: null });
    // Device ids: Gen2+ from /shelly, Gen1 hostname from /settings (only readable when open).
    expect(getDevice(db, 'E868E7A1B2C3')?.device_id).toBe('shelly1-A1B2C3');
    expect(getDevice(db, 'A8032AB12345')?.device_id).toBe('plus1pm-a8032ab12345');
    expect(getDevice(db, '7C2C67B2B2B2')?.device_id).toBe('s1pmg4-7c2c67b2b2b2');
    expect(byIp['10.0.0.6']).toMatchObject({ deviceId: 's1pmg4-7c2c67b2b2b2' });
    // Snapshots only for devices we could read: raw answers stored unchanged.
    const snaps = db.prepare('SELECT mac, info_json, config_json, status_json FROM config_snapshots ORDER BY mac').all() as {
      mac: string; info_json: string; config_json: string; status_json: string;
    }[];
    expect(snaps.map((s) => s.mac)).toEqual(['34CDB0A1A1A1', 'A8032AB12345', 'E868E7A1B2C3']);
    const gen1 = snaps.find((s) => s.mac === 'E868E7A1B2C3');
    expect(JSON.parse(gen1?.info_json ?? '')).toMatchObject({ type: 'SHSW-1', mac: 'E868E7A1B2C3', longid: 1 });
    expect(JSON.parse(gen1?.config_json ?? '')).toMatchObject({ name: 'Licht Keller', relays: [{ appliance_type: 'General' }] });
    expect(JSON.parse(gen1?.status_json ?? '')).toMatchObject({ relays: [{ ison: false }] });
  });

  it('uses credentials for protected devices and reports a wrong password per device without aborting', async () => {
    const a = await makeApp();
    const scan = await startScan(a, { range: '10.0.0.1-10.0.0.8', credentials: { password: 'gen2-secret' } });
    const done = await waitFor(a, scan.id);
    expect(done).toMatchObject({ status: 'done', found: 6, errors: 2, withCredentials: true });

    const byIp = Object.fromEntries(done.devices.map((d) => [d.ip, d]));
    expect(byIp['10.0.0.4']).toMatchObject({ snapshot: 'ok', name: 'Rollladen Büro', errorCode: null });
    expect(byIp['10.0.0.2']).toMatchObject({ snapshot: 'error', errorCode: 'auth_invalid' });
    expect(byIp['10.0.0.6']).toMatchObject({ snapshot: 'error', errorCode: 'auth_invalid' });
    // Unprotected devices never receive the credentials.
    expect(byIp['10.0.0.1']).toMatchObject({ snapshot: 'ok' });
    // Devices with a wrong password are still inventoried.
    expect(getDevice(db, '7C2C67B2B2B2')).toMatchObject({ auth_required: 1, ip: '10.0.0.6' });
  });

  it('never returns or logs the password', async () => {
    const lines: string[] = [];
    const a = await makeApp({}, { write: (msg) => lines.push(msg) }, 'trace');
    const scan = await startScan(a, { range: '10.0.0.1-10.0.0.8', credentials: { username: 'admin', password: 'gen2-secret' } });
    const details = await waitFor(a, scan.id);
    const list = await a.inject({ method: 'GET', url: '/api/scans' });
    expect(JSON.stringify(details)).not.toContain('gen2-secret');
    expect(list.body).not.toContain('gen2-secret');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('gen2-secret');
  });

  it('keeps location and notes when a device comes back under another IP', async () => {
    const a = await makeApp();
    await waitFor(a, (await startScan(a, { range: '10.0.0.3' })).id);
    db.prepare("UPDATE devices SET location = 'Keller', notes = 'Boiler-Steuerung' WHERE mac = 'A8032AB12345'").run();

    // The Plus1PM moves from 10.0.0.3 to 10.0.0.50.
    const boiler = fleet.devices[2]?.host ?? '';
    hostMap.delete('10.0.0.3');
    hostMap.set('10.0.0.50', boiler);
    try {
      const done = await waitFor(a, (await startScan(a, { range: '10.0.0.48/30' })).id);
      expect(done.devices).toMatchObject([{ ip: '10.0.0.50', created: false }]);
    } finally {
      hostMap.delete('10.0.0.50');
      hostMap.set('10.0.0.3', boiler);
    }
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ ip: '10.0.0.50', location: 'Keller', notes: 'Boiler-Steuerung', state: 'active' });
  });

  it('marks devices that no longer answer at their IP as missing', async () => {
    const a = await makeApp();
    await waitFor(a, (await startScan(a, { range: '10.0.0.1-10.0.0.3' })).id);
    const original = hostMap.get('10.0.0.1') ?? '';
    hostMap.set('10.0.0.1', closedHost);
    try {
      const done = await waitFor(a, (await startScan(a, { range: '10.0.0.1-10.0.0.3' })).id);
      expect(done.missing).toEqual(['E868E7A1B2C3']);
    } finally {
      hostMap.set('10.0.0.1', original);
    }
    expect(getDevice(db, 'E868E7A1B2C3')?.state).toBe('missing');
  });

  it('can be cancelled and allows only one running scan', async () => {
    // Every address hangs: without cancelling this would take 1024 / 4 * 5 s.
    const a = await makeApp({ hostFor: () => hang.host, probeTimeoutMs: 5000, concurrency: 4 });
    const scan = await startScan(a, { range: '10.1.0.0-10.1.3.255' });

    const busy = await a.inject({ method: 'POST', url: '/api/scans', payload: { range: '10.2.0.1' } });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({ error: 'scan_running', runningId: scan.id });

    const cancel = await a.inject({ method: 'DELETE', url: `/api/scans/${scan.id}` });
    expect(cancel.statusCode).toBe(202);
    const started = Date.now();
    const done = await waitFor(a, scan.id);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(done).toMatchObject({ status: 'cancelled', scanned: 0, missing: [] });

    const again = await a.inject({ method: 'DELETE', url: `/api/scans/${scan.id}` });
    expect(again.statusCode).toBe(409);
  });

  it('validates the input', async () => {
    const a = await makeApp();
    const tooLarge = await a.inject({ method: 'POST', url: '/api/scans', payload: { range: '10.0.0.0/21' } });
    expect(tooLarge.statusCode).toBe(400);
    expect(tooLarge.json()).toMatchObject({ error: 'invalid_range' });
    expect((await a.inject({ method: 'POST', url: '/api/scans', payload: { range: 'hallo' } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/scans', payload: {} })).statusCode).toBe(400);
    expect(
      (await a.inject({ method: 'POST', url: '/api/scans', payload: { range: '10.0.0.1', credentials: { password: '' } } })).statusCode,
    ).toBe(400);
    expect((await a.inject({ method: 'GET', url: '/api/scans/unknown' })).statusCode).toBe(404);
  });

  it('streams progress as server-sent events', async () => {
    const a = await makeApp();
    await a.listen({ port: 0, host: '127.0.0.1' });
    const address = a.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    const scan = await startScan(a, { range: '10.0.0.1-10.0.0.8' });
    const res = await fetch(`http://127.0.0.1:${port}/api/scans/${scan.id}/events`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // the server ends the stream after "finished"
    const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);

    expect(events[0]).toBe('snapshot');
    expect(events.at(-1)).toBe('finished');
    // Some devices may already be in the snapshot; the rest arrive as "device" events.
    const snapshot = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? '{}') as ScanDetails;
    expect(snapshot.devices.length + events.filter((e) => e === 'device').length).toBe(6);
    const finished = JSON.parse([...text.matchAll(/^data: (.*)$/gm)].at(-1)?.[1] ?? '{}') as ScanSummary;
    expect(finished).toMatchObject({ status: 'done', scanned: 8, found: 6 });
  });
});
