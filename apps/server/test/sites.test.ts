import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { listActions } from '../src/db/actions.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { getDevice, upsertSeenDevice } from '../src/db/devices.js';
import type { ScanDetails } from '../src/scan/scan-job.js';
import { probeShelly } from '../src/shelly/detect.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from './mock-shelly/index.js';

const BOILER: MockDeviceSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
const LICHT: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };

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

async function setup(specs: MockDeviceSpec[] = []) {
  db = openDatabase(':memory:');
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'silent' },
    db,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', probeTimeoutMs: 300, adapterTimeoutMs: 1000 },
  });
  mocks = await Promise.all(specs.map((s) => startMockDevice(s)));
  mocks.forEach((m, i) => hostMap.set(`10.0.0.${i + 1}`, m.host));
  return app;
}

const req = (a: FastifyInstance, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
  a.inject({ method, url, ...(payload ? { payload } : {}) });

async function scan(a: FastifyInstance, range: string, siteId: number): Promise<ScanDetails> {
  const { id } = (await req(a, 'POST', '/api/scans', { range, siteId })).json<{ id: string }>();
  for (let i = 0; i < 100; i++) {
    const s = (await req(a, 'GET', `/api/scans/${id}`)).json<ScanDetails>();
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('scan did not finish');
}

describe('sites', () => {
  it('has a default site and manages sites', async () => {
    const a = await setup();
    expect((await req(a, 'GET', '/api/sites')).json()).toMatchObject([{ id: 1, name: 'Standard', deviceCount: 0 }]);
    const created = await req(a, 'POST', '/api/sites', { name: 'Ferienhaus', description: 'Engadin' });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;
    expect((await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json()).toMatchObject({ error: 'name_taken' });
    expect((await req(a, 'PUT', `/api/sites/${id}`, { name: 'Ferienwohnung' })).json()).toMatchObject({ name: 'Ferienwohnung', description: null });
    expect((await req(a, 'DELETE', `/api/sites/${id}`)).statusCode).toBe(204);
    expect((await req(a, 'DELETE', '/api/sites/1')).json()).toMatchObject({ error: 'last_site' });
  });

  it('keeps inventories apart: scans store per site, lists filter, IPs may overlap', async () => {
    const a = await setup([BOILER, LICHT]);
    const ferien = (await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json<{ id: number }>().id;
    await scan(a, '10.0.0.1', 1);
    // Same IP range in another site (separate network): the Gen1 device there must not clear the IP of site 1.
    hostMap.set('10.0.0.1', mocks[1]?.host ?? '');
    await scan(a, '10.0.0.1', ferien);

    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ site_id: 1, ip: '10.0.0.1' });
    expect(getDevice(db, 'E868E7A1B2C3')).toMatchObject({ site_id: ferien, ip: '10.0.0.1' });
    expect((await req(a, 'GET', '/api/devices?site=1')).json<{ mac: string }[]>().map((d) => d.mac)).toEqual(['A8032AB12345']);
    expect((await req(a, 'GET', `/api/devices?site=${ferien}`)).json<{ mac: string; siteId: number }[]>()).toMatchObject([
      { mac: 'E868E7A1B2C3', siteId: ferien },
    ]);
    expect((await req(a, 'GET', '/api/devices')).json<unknown[]>()).toHaveLength(2);
    expect((await req(a, 'DELETE', `/api/sites/${ferien}`)).json()).toMatchObject({ error: 'site_not_empty' });
  });

  it('reports devices of another site in a scan without touching them', async () => {
    const a = await setup([BOILER]);
    const ferien = (await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json<{ id: number }>().id;
    await scan(a, '10.0.0.1', 1);
    db.prepare("UPDATE devices SET location = 'Keller' WHERE mac = 'A8032AB12345'").run();
    const requestsBefore = mocks[0]?.state.requests.length ?? 0;

    const result = await scan(a, '10.0.0.1', ferien);
    expect(result.devices).toMatchObject([{ mac: 'A8032AB12345', snapshot: 'foreign', foreignSite: { id: 1, name: 'Standard' } }]);
    expect(getDevice(db, 'A8032AB12345')).toMatchObject({ site_id: 1, location: 'Keller' });
    // Only /shelly was asked; no config was read with the other site's credentials.
    expect(mocks[0]?.state.requests.slice(requestsBefore)).toEqual(['GET /shelly']);
    // A completed scan of the other site does not mark it missing either.
    expect(getDevice(db, 'A8032AB12345')?.state).toBe('active');
  });

  it('moves a device explicitly and logs actions with the site at that time', async () => {
    const a = await setup([BOILER]);
    const ferien = (await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json<{ id: number }>().id;
    upsertSeenDevice(db, await probeShelly(mocks[0]?.host ?? ''), '10.0.0.1', '2026-10-17T10:00:00.000Z', 1);
    await req(a, 'POST', '/api/devices/A8032AB12345/snapshot');
    const moved = await req(a, 'PATCH', '/api/devices/A8032AB12345', { siteId: ferien });
    expect(moved.json()).toMatchObject({ siteId: ferien });
    await req(a, 'POST', '/api/devices/A8032AB12345/reboot');

    expect(listActions(db, { siteId: 1 }).map((x) => x.action)).toEqual(['snapshot']);
    expect(listActions(db, { siteId: ferien }).map((x) => x.action)).toEqual(['reboot']);
    expect((await req(a, 'GET', `/api/actions?site=${ferien}`)).json<unknown[]>()).toHaveLength(1);
    expect((await req(a, 'PATCH', '/api/devices/A8032AB12345', { siteId: 99 })).json()).toMatchObject({ error: 'site_not_found' });
  });

  it('scopes templates: names per site, preview and apply only within the site', async () => {
    const a = await setup([BOILER]);
    const ferien = (await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json<{ id: number }>().id;
    upsertSeenDevice(db, await probeShelly(mocks[0]?.host ?? ''), '10.0.0.1', '2026-10-17T10:00:00.000Z', 1);
    const t1 = (await req(a, 'POST', '/api/templates', { name: 'Haus', settings: { cloud: { enable: false } } })).json<{ id: number; siteId: number }>();
    const t2 = await req(a, 'POST', '/api/templates', { name: 'Haus', siteId: ferien, settings: { cloud: { enable: false } } });
    expect(t1.siteId).toBe(1);
    expect(t2.statusCode).toBe(201); // same name, other site
    expect((await req(a, 'POST', '/api/templates', { name: 'Haus', settings: { cloud: { enable: true } } })).json()).toMatchObject({ error: 'name_taken' });
    expect((await req(a, 'GET', `/api/templates?site=${ferien}`)).json<unknown[]>()).toHaveLength(1);

    const t2id = t2.json<{ id: number }>().id;
    expect((await req(a, 'POST', `/api/templates/${t2id}/preview`, {})).json()).toEqual([]);
    expect((await req(a, 'POST', `/api/templates/${t2id}/preview`, { macs: ['A8032AB12345'] })).json()).toEqual([]);
    const wrong = await req(a, 'POST', '/api/devices/A8032AB12345/apply-template', { templateId: t2id });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json()).toMatchObject({ error: 'site_mismatch' });
    expect((await req(a, 'POST', '/api/devices/A8032AB12345/apply-template', { templateId: t1.id })).json()).toMatchObject({ changed: 1 });
  });

  it('exports per site', async () => {
    const a = await setup([BOILER, LICHT]);
    const ferien = (await req(a, 'POST', '/api/sites', { name: 'Ferienhaus' })).json<{ id: number }>().id;
    upsertSeenDevice(db, await probeShelly(mocks[0]?.host ?? ''), '10.0.0.1', '2026-10-17T10:00:00.000Z', 1);
    upsertSeenDevice(db, await probeShelly(mocks[1]?.host ?? ''), '10.0.0.2', '2026-10-17T10:00:00.000Z', ferien);
    const json = (await req(a, 'GET', `/api/export.json?site=${ferien}`)).json<{ site: unknown; devices: { mac: string; site: unknown }[] }>();
    expect(json.site).toEqual({ id: ferien, name: 'Ferienhaus' });
    expect(json.devices).toMatchObject([{ mac: 'E868E7A1B2C3', site: { id: ferien, name: 'Ferienhaus' } }]);
    const csv = (await req(a, 'GET', '/api/export.csv?site=1')).body.split('\r\n');
    expect(csv).toHaveLength(3);
    expect(csv[1]?.startsWith('Standard;Boiler;')).toBe(true);
  });
});
