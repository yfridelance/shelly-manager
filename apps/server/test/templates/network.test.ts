import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { listActions } from '../../src/db/actions.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { getDevice, upsertSeenDevice } from '../../src/db/devices.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { RpcAdapter } from '../../src/shelly/rpc-adapter.js';
import { Gen1Adapter } from '../../src/shelly/gen1-adapter.js';
import { assignStaticIps, checkStaticIp, netmaskBits, subnetOf, validateNetwork } from '../../src/templates/ip-plan.js';
import { planTemplate, type PlanContext } from '../../src/templates/planner.js';
import { startMockDevice, type MockDevice, type MockDeviceSpec } from '../mock-shelly/index.js';

const NET = { ipFrom: '192.168.10.50', netmask: '255.255.255.0', gateway: '192.168.10.1' };

describe('ip-plan', () => {
  it('understands netmasks and subnets', () => {
    expect(netmaskBits('255.255.255.0')).toBe(24);
    expect(netmaskBits('255.255.252.0')).toBe(22);
    expect(netmaskBits('255.0.255.0')).toBeUndefined();
    expect(subnetOf('192.168.10.77', '255.255.255.192')).toMatchObject({ bits: 26 });
    expect(subnetOf('192.168.10.77', '255.255.255.255')).toBeUndefined();
  });

  it('checks a planned address', () => {
    const taken = new Map([['192.168.10.60', 'OTHER']]);
    expect(checkStaticIp('192.168.10.55', NET, 'ME', taken)).toBeUndefined();
    expect(checkStaticIp('192.168.11.5', NET, 'ME', taken)).toBe('outside_subnet');
    expect(checkStaticIp('192.168.10.255', NET, 'ME', taken)).toBe('reserved');
    expect(checkStaticIp('192.168.10.1', NET, 'ME', taken)).toBe('gateway');
    expect(checkStaticIp('192.168.10.60', NET, 'ME', taken)).toBe('taken');
    expect(checkStaticIp('192.168.10.60', NET, 'OTHER', taken)).toBeUndefined();
    expect(checkStaticIp('nope', NET, 'ME', taken)).toBe('invalid');
  });

  it('assigns incrementally, keeps existing static IPs and skips used ones', () => {
    const taken = new Map([['192.168.10.51', 'X'], ['192.168.10.53', 'B']]);
    const result = assignStaticIps(
      [{ mac: 'A' }, { mac: 'B' }, { mac: 'C', currentStatic: '192.168.10.70' }, { mac: 'D', currentStatic: '192.168.10.20' }],
      NET,
      taken,
    );
    // C keeps its static IP; D's static IP lies below the range and is replaced. B's current address .53
    // stays taken until B has actually moved (devices are reconfigured in parallel), so D gets .54.
    expect(Object.fromEntries(result)).toEqual({ A: '192.168.10.50', B: '192.168.10.52', C: '192.168.10.70', D: '192.168.10.54' });
    // A device may take its own current address.
    expect(assignStaticIps([{ mac: 'A' }, { mac: 'X' }], NET, taken).get('X')).toBe('192.168.10.51');
  });

  it('stops when the subnet is full', () => {
    const tiny = { ipFrom: '10.0.0.1', netmask: '255.255.255.252' };
    expect(Object.fromEntries(assignStaticIps([{ mac: 'A' }, { mac: 'B' }, { mac: 'C' }], tiny, new Map()))).toEqual({ A: '10.0.0.1', B: '10.0.0.2' });
  });

  it('validates template network settings with German messages', () => {
    expect(validateNetwork('sta', { mode: 'dhcp' })).toBeUndefined();
    expect(validateNetwork('sta', { mode: 'static', ipFrom: '192.168.10.50' })).toMatch(/Netzmaske/);
    expect(validateNetwork('sta1', { mode: 'static', ipFrom: '192.168.10.0', netmask: '255.255.255.0' })).toMatch(/Zweites WLAN.*Netz- oder Broadcast/);
    expect(validateNetwork('sta', { ...NET, mode: 'static', gateway: '10.0.0.1' })).toMatch(/Gateway 10.0.0.1 liegt nicht im Netz/);
    expect(validateNetwork('sta', { ...NET, mode: 'static' })).toBeUndefined();
  });
});

const GEN2_CFG = {
  cloud: { enable: true },
  wifi: {
    sta: { ssid: 'Haus', enable: true, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
    sta1: { ssid: null, enable: false, ipv4mode: 'dhcp', ip: null, netmask: null, gw: null, nameserver: null },
  },
};
const GEN1_CFG = {
  cloud: { enabled: true },
  wifi_sta: { enabled: true, ssid: 'Haus', ipv4_method: 'dhcp', ip: null, gw: null, mask: null, dns: null },
  wifi_sta1: { enabled: false, ssid: null, ipv4_method: 'dhcp', ip: null, gw: null, mask: null, dns: null },
};

describe('planTemplate network', () => {
  const ctx: PlanContext = { deviceId: 'x', mac: 'A', assignedIps: { sta: '192.168.10.50' } };

  it('plans Gen2 static IP settings as one WiFi.SetConfig, kept apart from the other steps', () => {
    const plan = planTemplate(2, GEN2_CFG, { cloud: { enable: false }, network: { sta: { mode: 'static', ...NET, dns: '192.168.10.2' } } }, ctx);
    expect(plan.steps).toEqual([{ kind: 'rpc', method: 'Cloud.SetConfig', params: { config: { enable: false } } }]);
    expect(plan.network).toEqual([
      {
        iface: 'sta',
        mode: 'static',
        ip: '192.168.10.50',
        step: {
          kind: 'rpc',
          method: 'WiFi.SetConfig',
          params: { config: { sta: { ipv4mode: 'static', ip: '192.168.10.50', netmask: '255.255.255.0', gw: '192.168.10.1', nameserver: '192.168.10.2' } } },
        },
      },
    ]);
    expect(plan.items.filter((i) => i.key.startsWith('network.')).map((i) => [i.key, i.status, i.target])).toEqual([
      ['network.sta.mode', 'change', 'static'],
      ['network.sta.ip', 'change', '192.168.10.50'],
      ['network.sta.netmask', 'change', '255.255.255.0'],
      ['network.sta.gateway', 'change', '192.168.10.1'],
      ['network.sta.dns', 'change', '192.168.10.2'],
    ]);
  });

  it('plans Gen1 with /settings/sta parameter names and changes nothing when already set', () => {
    const plan = planTemplate(1, GEN1_CFG, { network: { sta: { mode: 'static', ...NET } } }, ctx);
    expect(plan.network[0]?.step).toEqual({
      kind: 'gen1',
      path: '/settings/sta',
      params: { ipv4_method: 'static', ip: '192.168.10.50', netmask: '255.255.255.0', gateway: '192.168.10.1' },
    });
    const done = { ...GEN1_CFG, wifi_sta: { ...GEN1_CFG.wifi_sta, ipv4_method: 'static', ip: '192.168.10.50', mask: '255.255.255.0', gw: '192.168.10.1' } };
    expect(planTemplate(1, done, { network: { sta: { mode: 'static', ...NET } } }, ctx).network).toEqual([]);
  });

  it('reports why nothing is planned', () => {
    const items = (settings: Parameters<typeof planTemplate>[2], c = ctx, gen: 1 | 2 = 2, cfg: unknown = GEN2_CFG) =>
      planTemplate(gen, cfg, settings, c).items.map((i) => [i.key, i.status, i.reason]);
    expect(items({ network: { sta1: { mode: 'dhcp' } } })).toEqual([['network.sta1.mode', 'unsupported', 'inactive']]);
    expect(items({ network: { sta: { mode: 'static', ...NET } } }, { deviceId: 'x', mac: 'A', assignedIps: {} })).toEqual([
      ['network.sta.mode', 'unsupported', 'no_ip'],
    ]);
    // Gen1 docs: static without gateway needs the cloud disabled first.
    const noGw = { mode: 'static' as const, ipFrom: NET.ipFrom, netmask: NET.netmask };
    expect(items({ network: { sta: noGw } }, ctx, 1, GEN1_CFG)).toEqual([['network.sta.mode', 'unsupported', 'gateway_cloud']]);
    expect(items({ cloud: { enable: false }, network: { sta: noGw } }, ctx, 1, GEN1_CFG)[1]).toEqual(['network.sta.mode', 'change', undefined]);
  });

  it('switches back to DHCP', () => {
    const cfg = { ...GEN2_CFG, wifi: { ...GEN2_CFG.wifi, sta: { ...GEN2_CFG.wifi.sta, ipv4mode: 'static', ip: '192.168.10.50' } } };
    expect(planTemplate(2, cfg, { network: { sta: { mode: 'dhcp' } } }, ctx).network).toEqual([
      { iface: 'sta', mode: 'dhcp', ip: null, step: { kind: 'rpc', method: 'WiFi.SetConfig', params: { config: { sta: { ipv4mode: 'dhcp' } } } } },
    ]);
  });
});

// --- API against the mock ----------------------------------------------------------------

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

/** Devices at 192.168.10.(11+i); a static IP change moves the mapping like a real reconnect (unless `stay`). */
async function setup(specs: MockDeviceSpec[], opts: { stay?: boolean } = {}) {
  db = openDatabase(':memory:');
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'silent' },
    db,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', adapterTimeoutMs: 1000 },
    devices: { networkSettleMs: 20, networkWaitMs: 400 },
  });
  mocks = [];
  for (const [i, spec] of specs.entries()) {
    const ip = `192.168.10.${11 + i}`;
    let current = ip;
    const dev = await startMockDevice({
      ...spec,
      onIpChange: (_iface, newIp) => {
        if (opts.stay || !newIp) return;
        hostMap.delete(current);
        hostMap.set(newIp, dev.host);
        current = newIp;
      },
    } as MockDeviceSpec);
    mocks.push(dev);
    hostMap.set(ip, dev.host);
    upsertSeenDevice(db, await probeShelly(dev.host), ip, '2026-10-17T10:00:00.000Z');
  }
  return app;
}

const json = (a: FastifyInstance, url: string, payload: Record<string, unknown> = {}) => a.inject({ method: 'POST', url, payload });

const GEN2_A: MockDeviceSpec = { kind: 'rpc', gen: 2, mac: 'A8032AB12345', model: 'SNSW-001P16EU', app: 'Plus1PM', name: 'Boiler' };
const GEN2_B: MockDeviceSpec = { kind: 'rpc', gen: 3, mac: '34CDB0A1A1A1', model: 'S3SW-001X16EU', app: 'Mini1G3', name: 'Aussenlicht' };
const GEN1_A: MockDeviceSpec = { kind: 'gen1', mac: 'E868E7A1B2C3', type: 'SHSW-1', name: 'Licht Keller' };

async function staticTemplate(a: FastifyInstance, extra: Record<string, unknown> = {}): Promise<number> {
  const res = await json(a, '/api/templates', { name: 'Fix-IP', settings: { network: { sta: { mode: 'static', ...NET } }, ...extra } });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: number }>().id;
}

describe('network templates via API', () => {
  it('rejects invalid network settings', async () => {
    const a = await setup([]);
    const res = await json(a, '/api/templates', { name: 'x', settings: { network: { sta: { mode: 'static', ipFrom: '192.168.10.50' } } } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_network', message: expect.stringContaining('Netzmaske') });
  });

  it('plans IPs in the preview ordered by location and name', async () => {
    const a = await setup([GEN2_A, GEN2_B, GEN1_A]);
    for (const m of ['A8032AB12345', '34CDB0A1A1A1', 'E868E7A1B2C3']) await json(a, `/api/devices/${m}/snapshot`);
    db.prepare("UPDATE devices SET location = 'Garten' WHERE mac = '34CDB0A1A1A1'").run();
    db.prepare("UPDATE devices SET location = 'Keller' WHERE mac IN ('A8032AB12345', 'E868E7A1B2C3')").run();
    db.prepare("UPDATE devices SET ip = '192.168.10.51' WHERE mac = 'E868E7A1B2C3'").run(); // its DHCP address lies in the range
    hostMap.set('192.168.10.51', mocks[2]?.host ?? '');
    const id = await staticTemplate(a);

    const preview = (await json(a, `/api/templates/${id}/preview`)).json<{ mac: string; assignedIps: { sta?: string } }[]>();
    expect(Object.fromEntries(preview.map((p) => [p.mac, p.assignedIps.sta]))).toEqual({
      '34CDB0A1A1A1': '192.168.10.50', // Garten first
      A8032AB12345: '192.168.10.52', // .51 belongs to Licht Keller
      E868E7A1B2C3: '192.168.10.51', // Keller, "Licht Keller" after "Boiler"; may take its own address
    });
  });

  it('plans IPs floor by floor in building order', async () => {
    const a = await setup([GEN2_A, GEN2_B, GEN1_A]);
    for (const m of ['A8032AB12345', '34CDB0A1A1A1', 'E868E7A1B2C3']) await json(a, `/api/devices/${m}/snapshot`);
    db.prepare("UPDATE devices SET floor = '1. OG', location = 'Bad' WHERE mac = 'A8032AB12345'").run();
    db.prepare("UPDATE devices SET floor = 'EG', location = 'Wohnen' WHERE mac = '34CDB0A1A1A1'").run();
    db.prepare("UPDATE devices SET floor = 'UG', location = 'Waschküche' WHERE mac = 'E868E7A1B2C3'").run();
    const id = await staticTemplate(a);
    const preview = (await json(a, `/api/templates/${id}/preview`)).json<{ mac: string; assignedIps: { sta?: string } }[]>();
    expect(Object.fromEntries(preview.map((p) => [p.mac, p.assignedIps.sta]))).toEqual({
      E868E7A1B2C3: '192.168.10.50', // UG
      '34CDB0A1A1A1': '192.168.10.51', // EG, although «Wohnen» sorts after «Bad»
      A8032AB12345: '192.168.10.52', // 1. OG
    });
  });

  it('switches a Gen2 device to a static IP, finds it again and updates the inventory', async () => {
    const a = await setup([GEN2_A]);
    const id = await staticTemplate(a, { mqtt: { enable: true } });
    const res = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id, rebootIfRequired: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ network: { ip: '192.168.10.50', confirmed: true }, restartRequired: true, rebooted: true });
    expect(getDevice(db, 'A8032AB12345')?.ip).toBe('192.168.10.50');
    // Reboot went to the new address, after the snapshot of the new state.
    expect(mocks[0]?.state.rebootCount).toBe(1);
    const config = (await new RpcAdapter(hostMap.get('192.168.10.50') ?? '').getConfig()) as { wifi: { sta: Record<string, unknown> } };
    expect(config.wifi.sta).toMatchObject({ ipv4mode: 'static', ip: '192.168.10.50', netmask: '255.255.255.0', gw: '192.168.10.1', ssid: 'Haus' });
    const log = listActions(db).find((l) => l.action === 'apply_template');
    expect(JSON.parse(log?.details ?? '{}')).toMatchObject({
      ipChange: { from: '192.168.10.11', to: '192.168.10.50', confirmed: true },
      snapshotAfterId: expect.any(Number),
    });
    // MQTT went out before the network change.
    const rpc = mocks[0]?.state.requests.filter((r) => r.includes('SetConfig')) ?? [];
    expect(rpc).toEqual(['RPC MQTT.SetConfig', 'RPC WiFi.SetConfig']);

    // A second run keeps the address and changes nothing.
    const again = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id });
    expect(again.json()).toMatchObject({ changed: 0 });
    expect(again.json<{ network?: unknown }>().network).toBeUndefined();
  });

  it('uses Gen1 /settings/sta', async () => {
    const a = await setup([GEN1_A]);
    const id = await staticTemplate(a);
    const res = await json(a, '/api/devices/E868E7A1B2C3/apply-template', { templateId: id, network: { sta: '192.168.10.77' } });
    expect(res.json()).toMatchObject({ network: { ip: '192.168.10.77', confirmed: true } });
    expect(mocks[0]?.state.requests).toContain('GET /settings/sta?ipv4_method=static&ip=192.168.10.77&netmask=255.255.255.0&gateway=192.168.10.1');
    const settings = (await new Gen1Adapter(hostMap.get('192.168.10.77') ?? '').getConfig()) as { wifi_sta: Record<string, unknown> };
    expect(settings.wifi_sta).toMatchObject({ ipv4_method: 'static', ip: '192.168.10.77', mask: '255.255.255.0', gw: '192.168.10.1' });
  });

  it('refuses conflicting addresses before changing anything', async () => {
    const a = await setup([GEN2_A, GEN2_B]);
    const id = await staticTemplate(a);
    // Taken by another device in the inventory.
    const taken = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id, network: { sta: '192.168.10.12' } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: 'ip_conflict', message: expect.stringContaining('another device') });
    // Outside the subnet.
    expect((await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id, network: { sta: '10.0.0.5' } })).json()).toMatchObject({ error: 'ip_conflict' });
    // Something answers at the address (not in the inventory).
    hostMap.set('192.168.10.90', mocks[1]?.host ?? '');
    const inUse = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id, network: { sta: '192.168.10.90' } });
    expect(inUse.json()).toMatchObject({ error: 'ip_conflict', message: expect.stringContaining('answers on the network') });
    expect(mocks[0]?.state.requests.filter((r) => r.includes('SetConfig'))).toEqual([]);
  });

  it('reports an unconfirmed change when the device does not show up at the new address', async () => {
    const a = await setup([GEN2_A], { stay: true });
    const id = await staticTemplate(a, { mqtt: { enable: true } });
    const res = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: id, rebootIfRequired: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ network: { ip: '192.168.10.50', confirmed: false }, rebooted: false });
    expect(getDevice(db, 'A8032AB12345')?.ip).toBe('192.168.10.50');
    expect(mocks[0]?.state.rebootCount).toBe(0);
    const details = JSON.parse(listActions(db).find((l) => l.action === 'apply_template')?.details ?? '{}') as Record<string, unknown>;
    expect(details).toMatchObject({ rebootSkipped: 'unreachable' });
    expect(details['snapshotAfterId']).toBeUndefined();
  });

  it('switches back to DHCP and keeps the address when the device answers there', async () => {
    const a = await setup([GEN2_A]);
    const staticId = await staticTemplate(a);
    await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: staticId });
    const dhcp = await json(a, '/api/templates', { name: 'DHCP', settings: { network: { sta: { mode: 'dhcp' } } } });
    const res = await json(a, '/api/devices/A8032AB12345/apply-template', { templateId: dhcp.json<{ id: number }>().id });
    // The mock keeps answering at its last address, like a DHCP server handing out the same lease.
    expect(res.json()).toMatchObject({ network: { ip: '192.168.10.50', confirmed: true } });
  });
});
