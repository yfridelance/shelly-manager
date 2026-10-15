import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { upsertSeenDevice } from '../../src/db/devices.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { RpcAdapter } from '../../src/shelly/rpc-adapter.js';
import { Gen1Adapter } from '../../src/shelly/gen1-adapter.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from '../mock-shelly/index.js';

const GEN1: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };
const GEN2: MockDeviceSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
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

async function setup(...specs: MockDeviceSpec[]): Promise<{ a: FastifyInstance; macs: string[] }> {
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
    hostMap.set(`10.0.0.${i + 1}`, m.host);
    const info = await probeShelly(m.host);
    upsertSeenDevice(db, info, `10.0.0.${i + 1}`, '2026-10-14T10:00:00.000Z');
    macs.push(info.mac);
  }
  return { a: app, macs };
}

const json = (a: FastifyInstance, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  a.inject({ method, url, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });

async function createTemplate(a: FastifyInstance, settings: Record<string, unknown>, name = 'Haus-Standard'): Promise<number> {
  const res = await json(a, 'POST', '/api/templates', { name, description: 'MQTT für Home Assistant', settings });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>().id;
}

describe('template CRUD', () => {
  it('creates, lists, updates and deletes templates', async () => {
    const { a } = await setup();
    const id = await createTemplate(a, { cloud: { enable: false } });
    expect((await json(a, 'GET', '/api/templates')).json()).toMatchObject([{ id, name: 'Haus-Standard', settings: { cloud: { enable: false } } }]);

    const updated = await json(a, 'PUT', `/api/templates/${id}`, { name: 'Haus', settings: { cloud: { enable: true }, time: { timezone: 'Europe/Zurich' } } });
    expect(updated.json()).toMatchObject({ name: 'Haus', description: null, settings: { time: { timezone: 'Europe/Zurich' } } });

    expect((await json(a, 'DELETE', `/api/templates/${id}`)).statusCode).toBe(204);
    expect((await json(a, 'GET', `/api/templates/${id}`)).statusCode).toBe(404);
  });

  it('validates names and settings', async () => {
    const { a } = await setup();
    await createTemplate(a, { cloud: { enable: false } });
    expect((await json(a, 'POST', '/api/templates', { name: 'Haus-Standard', settings: { cloud: { enable: true } } })).json()).toMatchObject({ error: 'name_taken' });
    expect((await json(a, 'POST', '/api/templates', { name: 'Leer', settings: {} })).json()).toMatchObject({ error: 'empty_template' });
    expect((await json(a, 'POST', '/api/templates', { name: 'Leer2', settings: { mqtt: {} } })).json()).toMatchObject({ error: 'empty_template' });
    for (const settings of [
      { wifi: { ssid: 'x' } }, // WLAN client settings are not offered on purpose
      { mqtt: { password: 'x' } }, // secrets are never part of a template
      { time: { timezone: 'Zürich; rm -rf' } },
      { apRoaming: { threshold: 10 } },
      { mqtt: { topicPrefix: '#all' } },
    ]) {
      expect((await json(a, 'POST', '/api/templates', { name: `x${JSON.stringify(settings)}`, settings })).statusCode).toBe(400);
    }
  });
});

describe('preview', () => {
  it('shows per device what would change, based on the newest snapshot', async () => {
    const { a, macs } = await setup(GEN1, GEN2, GEN4_PROTECTED);
    await json(a, 'POST', `/api/devices/${macs[0]}/snapshot`);
    await json(a, 'POST', `/api/devices/${macs[1]}/snapshot`);
    const id = await createTemplate(a, { cloud: { enable: false }, time: { sntpServer: 'time.google.com' }, coiot: { enable: false } });

    const res = await json(a, 'POST', `/api/templates/${id}/preview`, {});
    const preview = res.json<{ mac: string; basedOn: string | null; items: { key: string; status: string }[] }[]>();
    const byMac = Object.fromEntries(preview.map((p) => [p.mac, p]));
    expect(byMac['E868E7A1B2C3']?.items.map((i) => [i.key, i.status])).toEqual([
      ['cloud.enable', 'change'],
      ['time.sntpServer', 'same'],
      ['coiot.enable', 'change'],
    ]);
    expect(byMac['A8032AB12345']?.items.find((i) => i.key === 'coiot.enable')).toMatchObject({ status: 'unsupported', reason: 'generation' });
    // Protected device without snapshot: no basis yet.
    expect(byMac['7C2C67B2B2B2']).toMatchObject({ basedOn: null, items: [] });
    // The preview contacts no device.
    expect(mocks[0]?.state.requests.filter((r) => r.includes('/settings?'))).toEqual([]);
  });
});

describe('apply template', () => {
  it('applies Gen2 settings, reboots when required, logs the changes and is idempotent', async () => {
    const { a, macs } = await setup(GEN2);
    const id = await createTemplate(a, {
      mqtt: { enable: true, server: 'mqtt.home:1883', topicPrefix: 'haus/{id}' },
      cloud: { enable: false },
      eco: { ecoMode: true },
    });
    const res = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, rebootIfRequired: true, secrets: { mqttPassword: 'mqtt-geheim' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ changed: 6, restartRequired: true, rebooted: true });
    expect(mocks[0]?.state.rebootCount).toBe(1);
    expect(mocks[0]?.state.secretsReceived).toEqual({ 'mqtt.pass': 'mqtt-geheim' });

    const config = (await new RpcAdapter(mocks[0]?.host ?? '').getConfig()) as Record<string, Record<string, unknown>>;
    expect(config['mqtt']).toMatchObject({ enable: true, server: 'mqtt.home:1883', topic_prefix: 'haus/plus1pm-a8032ab12345' });
    expect(config['cloud']).toMatchObject({ enable: false });
    expect(config['sys']).toMatchObject({ device: { eco_mode: true } });

    const log = listActions(db).find((l) => l.action === 'apply_template');
    expect(log?.result).toBe('ok');
    const details = JSON.parse(log?.details ?? '{}') as {
      templateName: string;
      changes: { key: string; from: unknown; to: unknown }[];
      rebooted: boolean;
      snapshotAfterId?: number;
    };
    expect(details).toMatchObject({ templateName: 'Haus-Standard', rebooted: true });
    expect(details.changes).toContainEqual({ key: 'mqtt.server', from: null, to: 'mqtt.home:1883' });
    expect(details.changes).toContainEqual({ key: 'mqtt.password', from: '********', to: '********' });

    // A second snapshot documents the new state, so the preview now shows nothing left to do.
    expect(details).toMatchObject({ snapshotAfterId: expect.any(Number) });
    const preview = (await json(a, 'POST', `/api/templates/${id}/preview`, {})).json<{ items: { status: string }[] }[]>();
    expect(preview[0]?.items.filter((i) => i.status === 'change')).toEqual([]);

    // Second run: nothing to do, no reboot.
    const again = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, rebootIfRequired: true });
    expect(again.json()).toMatchObject({ changed: 0, restartRequired: false, rebooted: false });
    expect(mocks[0]?.state.rebootCount).toBe(1);

    const everything = [JSON.stringify(listActions(db)), JSON.stringify(db.prepare('SELECT * FROM config_snapshots').all()), logLines.join('\n')].join('\n');
    expect(everything).not.toContain('mqtt-geheim');
  });

  it('applies Gen1 settings via /settings and never leaks the MQTT password', async () => {
    const { a, macs } = await setup(GEN1);
    const id = await createTemplate(a, {
      mqtt: { enable: true, server: 'mqtt.home:1883', clientId: 'haus-{id}' },
      cloud: { enable: false },
      time: { timezone: 'Europe/Berlin' },
      coiot: { updatePeriod: 30 },
    });
    const res = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, secrets: { mqttPassword: 'mqtt-geheim' } });
    expect(res.json()).toMatchObject({ changed: 7, restartRequired: false, rebooted: false });

    const settings = (await new Gen1Adapter(mocks[0]?.host ?? '').getConfig()) as Record<string, unknown>;
    expect(settings).toMatchObject({
      mqtt: { enable: true, server: 'mqtt.home:1883', id: 'haus-shelly1-A1B2C3' },
      cloud: { enabled: false },
      timezone: 'Europe/Berlin',
      tzautodetect: false,
      coiot: { update_period: 30 },
    });
    expect(mocks[0]?.state.secretsReceived).toEqual({ mqtt_pass: 'mqtt-geheim' });
    // The mock logs parameter names only; our own log never sees the URL.
    expect(mocks[0]?.state.requests).toContain('GET /settings?mqtt_enable&mqtt_server&mqtt_id&timezone&tzautodetect&coiot_update_period&mqtt_pass');
    expect([JSON.stringify(listActions(db)), logLines.join('\n')].join('\n')).not.toContain('mqtt-geheim');
  });

  it('deploys a script, leaves it alone when unchanged and restarts it on new code', async () => {
    const { a, macs } = await setup(GEN2);
    const code = `// ${'x'.repeat(2500)}\nprint("hallo");`;
    const id = await createTemplate(a, { script: { name: 'heizung', code, enable: true, start: true } });

    const first = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(first.json()).toMatchObject({ changed: 1, script: { created: true, codeChanged: true, enableChanged: true, started: true } });
    const adapter = new RpcAdapter(mocks[0]?.host ?? '');
    expect(await adapter.call('Script.List')).toEqual({ scripts: [{ id: 1, name: 'heizung', enable: true, running: true }] });
    expect((await adapter.call('Script.GetCode', { id: 1 })) as { left: number }).toMatchObject({ left: expect.any(Number) });

    const second = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(second.json()).toMatchObject({ changed: 0, script: { created: false, codeChanged: false, enableChanged: false, started: false } });
    expect(second.json<{ items: { key: string; status: string }[] }>().items).toEqual([expect.objectContaining({ key: 'script', status: 'same' })]);

    await json(a, 'PUT', `/api/templates/${id}`, { name: 'Haus-Standard', settings: { script: { name: 'heizung', code: 'print("neu");', enable: true, start: true } } });
    const third = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(third.json()).toMatchObject({ changed: 1, script: { created: false, codeChanged: true, started: true } });
    expect(mocks[0]?.state.requests).toContain('RPC Script.Stop');
  });

  it('changes nothing on a protected device without credentials', async () => {
    const { a, macs } = await setup(GEN4_PROTECTED);
    const id = await createTemplate(a, { cloud: { enable: false } });
    const res = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'snapshot_failed', cause: 'auth_required' });
    expect(mocks[0]?.state.requests.filter((r) => r.includes('SetConfig'))).toEqual([]);

    const ok = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, credentials: { password: 'gen4-secret' } });
    expect(ok.json()).toMatchObject({ changed: 1 });
  });

  it('reports a failure in the middle with the calls already made', async () => {
    const { a, macs } = await setup({ ...GEN2, failing: ['Cloud.SetConfig'] } as MockDeviceSpec);
    const id = await createTemplate(a, { mqtt: { enable: true }, cloud: { enable: false } });
    const res = await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'template_failed', cause: 'rpc' });
    const log = listActions(db).find((l) => l.action === 'apply_template');
    expect(log).toMatchObject({ result: 'error', error_code: 'template_failed' });
    expect(JSON.parse(log?.details ?? '{}')).toMatchObject({ appliedSteps: ['MQTT.SetConfig'] });
  });

  it('rejects unknown templates and unknown secrets', async () => {
    const { a, macs } = await setup(GEN2);
    expect((await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: 999 })).json()).toMatchObject({ error: 'template_not_found' });
    const id = await createTemplate(a, { cloud: { enable: false } });
    expect((await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, secrets: { devicePassword: 'x' } })).statusCode).toBe(400);
    expect((await json(a, 'POST', `/api/devices/${macs[0]}/apply-template`, { templateId: id, secrets: { apPassword: 'kurz' } })).statusCode).toBe(400);
  });
});
