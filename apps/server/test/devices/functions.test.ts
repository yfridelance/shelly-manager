import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { upsertSeenDevice } from '../../src/db/devices.js';
import { insertSnapshot } from '../../src/db/snapshots.js';
import { deriveFunctions, describeFunctions } from '../../src/devices/functions.js';
import { probeShelly } from '../../src/shelly/detect.js';
import { DEFAULT_FLEET, startMockFleet, type MockFleet } from '../mock-shelly/index.js';

const none = { switch: 0, cover: 0, light: 0, meter: 0, input: 0, sensor: 0, metering: false };

describe('deriveFunctions', () => {
  it('reads Gen2+ components and metering from the status', () => {
    const plus2pmCover = deriveFunctions(2, { 'cover:0': {}, 'input:0': {}, 'input:1': {}, sys: {} }, { 'cover:0': { apower: 0 } });
    expect(plus2pmCover).toEqual({ ...none, cover: 1, input: 2, metering: true });
    const plus2pmSwitch = deriveFunctions(2, { 'switch:0': {}, 'switch:1': {} }, { 'switch:0': { apower: 3 }, 'switch:1': { apower: 0 } });
    expect(describeFunctions(plus2pmSwitch)).toBe('2× Schalter · Messung');
    // Plus 1 (no PM): no apower in the switch status.
    expect(describeFunctions(deriveFunctions(2, { 'switch:0': {}, 'input:0': {} }, { 'switch:0': { output: true } }))).toBe('Schalter');
    expect(describeFunctions(deriveFunctions(2, { 'em:0': {}, 'emdata:0': {} }, {}))).toBe('Energiezähler');
    expect(describeFunctions(deriveFunctions(3, { 'pm1:0': {} }, {}))).toBe('Energiezähler');
    expect(describeFunctions(deriveFunctions(2, { 'light:0': {} }, { 'light:0': { apower: 1 } }))).toBe('Licht · Messung');
    // Plus i4: only inputs.
    expect(describeFunctions(deriveFunctions(2, { 'input:0': {}, 'input:1': {}, 'input:2': {}, 'input:3': {} }, {}))).toBe('4× Eingang');
    expect(describeFunctions(deriveFunctions(2, { 'temperature:0': {}, 'humidity:0': {}, 'devicepower:0': {} }, {}))).toBe('2× Sensor');
  });

  it('reads Gen1 relays, rollers by mode and real metering only', () => {
    // Shelly 1: meters without energy counter (configured constant) is no metering.
    expect(deriveFunctions(1, { relays: [{}] }, { relays: [{}], meters: [{ power: 0, is_valid: true }], inputs: [{}] })).toEqual({
      ...none,
      switch: 1,
      input: 1,
    });
    expect(describeFunctions(deriveFunctions(1, { relays: [{}] }, { meters: [{ power: 0, total: 12 }] }))).toBe('Schalter · Messung');
    // Shelly 2.5 lists relays and rollers in /settings; mode decides.
    const s25 = { mode: 'roller', relays: [{}, {}], rollers: [{}] };
    expect(describeFunctions(deriveFunctions(1, s25, { meters: [{ total: 1 }, { total: 2 }] }))).toBe('Rollladen · Messung');
    expect(describeFunctions(deriveFunctions(1, { ...s25, mode: 'relay' }, {}))).toBe('2× Schalter');
    expect(describeFunctions(deriveFunctions(1, { lights: [{}, {}, {}, {}] }, {}))).toBe('4× Licht');
    expect(describeFunctions(deriveFunctions(1, {}, { emeters: [{}, {}, {}] }))).toBe('Energiezähler');
    // H&T reports tmp/hum; a relay device only its own tmp.
    expect(describeFunctions(deriveFunctions(1, {}, { tmp: {}, hum: {} }))).toBe('Sensor');
    expect(describeFunctions(deriveFunctions(1, { relays: [{}] }, { tmp: {} }))).toBe('Schalter');
  });

  it('is null without a config', () => {
    expect(deriveFunctions(2, null, {})).toBeNull();
    expect(describeFunctions(null)).toBe('');
  });
});

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

async function makeApp(): Promise<FastifyInstance> {
  db = openDatabase(':memory:');
  app = await buildApp({
    config: { staticDir: undefined, logLevel: 'silent' },
    db,
    scan: { hostFor: (ip) => hostMap.get(ip) ?? '127.0.0.1:1', adapterTimeoutMs: 1000 },
  });
  return app;
}

const PASSWORDS: Record<number, string> = { 2: 'gen1-secret', 4: 'gen2-secret', 6: 'gen4-secret' };

describe('device functions and type via the API', () => {
  it('derives the function of every mock device from its snapshot', async () => {
    const a = await makeApp();
    for (let i = 1; i <= 6; i++) {
      const info = await probeShelly(hostMap.get(`10.0.0.${i}`) ?? '');
      upsertSeenDevice(db, info, `10.0.0.${i}`, '2026-10-14T10:00:00.000Z');
      const password = PASSWORDS[i];
      const res = await a.inject({ method: 'POST', url: `/api/devices/${info.mac}/snapshot`, payload: password ? { credentials: { password } } : {} });
      expect(res.statusCode).toBe(201);
    }
    const devices = (await a.inject({ method: 'GET', url: '/api/devices' })).json() as { name: string; functions: unknown }[];
    const byName = Object.fromEntries(devices.map((d) => [d.name ?? 'Mini', describeFunctions(d.functions as never)]));
    expect(byName).toEqual({
      'Licht Keller': 'Schalter',
      'Storen Wohnzimmer': 'Rollladen · Messung',
      Boiler: 'Schalter · Messung',
      'Rollladen Büro': 'Rollladen · Messung',
      Mini: 'Schalter',
      Garage: 'Schalter · Messung',
    });

    const csv = (await a.inject({ method: 'GET', url: '/api/export.csv' })).body;
    expect(csv.split('\r\n')[0]).toContain(';App;Funktion;Generation;');
    expect(csv).toContain(';Rollladen · Messung;');
  });

  it('keeps the type as a local field, also in the export', async () => {
    const a = await makeApp();
    const info = await probeShelly(hostMap.get('10.0.0.3') ?? '');
    upsertSeenDevice(db, info, '10.0.0.3', '2026-10-14T10:00:00.000Z');
    const res = await a.inject({ method: 'PATCH', url: `/api/devices/${info.mac}`, payload: { kind: ' Boiler ' } });
    expect(res.json()).toMatchObject({ kind: 'Boiler', functions: null });
    expect((await a.inject({ method: 'PATCH', url: `/api/devices/${info.mac}`, payload: { kind: 'x'.repeat(101) } })).statusCode).toBe(400);
    const json = (await a.inject({ method: 'GET', url: '/api/export.json' })).json() as { devices: { kind: string }[] };
    expect(json.devices[0]).toMatchObject({ kind: 'Boiler', functions: null });
    // A scan does not touch it.
    upsertSeenDevice(db, info, '10.0.0.3', '2026-10-14T11:00:00.000Z');
    expect((await a.inject({ method: 'GET', url: `/api/devices/${info.mac}` })).json()).toMatchObject({ device: { kind: 'Boiler' } });
  });
});

describe('backfill', () => {
  it('derives functions for existing devices from their newest snapshot at start', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-functions-'));
    const file = path.join(dir, 'db.sqlite');
    try {
      const first = openDatabase(file);
      upsertSeenDevice(
        first,
        { mac: 'A8032AB67890', gen: 2, model: 'SNSW-102P16EU', app: 'Plus2PM', firmware: null, name: null, deviceId: null, authRequired: false, raw: { gen: 2 } },
        '10.0.0.4',
        '2026-10-14T10:00:00.000Z',
      );
      insertSnapshot(first, { mac: 'A8032AB67890', takenAt: '2026-10-14T10:00:00.000Z', info: { gen: 2 }, config: { 'cover:0': {} }, status: {} });
      // As before migration 011 filled anything.
      first.prepare('UPDATE devices SET functions = NULL').run();
      first.close();
      const again = openDatabase(file);
      expect(JSON.parse(again.prepare('SELECT functions FROM devices').pluck().get() as string)).toMatchObject({ cover: 1 });
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
