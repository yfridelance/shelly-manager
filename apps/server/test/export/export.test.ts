import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { openDatabase, type Db } from '../../src/db/database.js';
import { upsertSeenDevice } from '../../src/db/devices.js';
import { insertSnapshot } from '../../src/db/snapshots.js';
import { toCsv } from '../../src/export/csv.js';
import type { DeviceInfo } from '../../src/shelly/types.js';

const info = (over: Partial<DeviceInfo>): DeviceInfo => ({
  mac: 'A8032AB12345', gen: 2, model: 'SNSW-001P16EU', app: 'Plus1PM', firmware: '20241011-114455/1.4.4-g6d2a586',
  name: 'Boiler', authRequired: false, raw: { id: 'shellyplus1pm-a8032ab12345' }, ...over,
});

describe('toCsv', () => {
  it('uses semicolons, CRLF and a BOM', () => {
    expect(toCsv(['a', 'b'], [['x', 1]])).toBe('﻿a;b\r\nx;1\r\n');
  });

  it('quotes separators, quotes and line breaks', () => {
    expect(toCsv(['n'], [['Keller; links'], ['Er sagte "hallo"'], ['Zeile 1\nZeile 2'], [null]])).toBe(
      '﻿n\r\n"Keller; links"\r\n"Er sagte ""hallo"""\r\n"Zeile 1\nZeile 2"\r\n\r\n',
    );
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(toCsv(['n'], [['=HYPERLINK("x")'], ['+41 44'], ['-1'], ['@SUM(A1)']])).toBe(
      '﻿n\r\n"\'=HYPERLINK(""x"")"\r\n\'+41 44\r\n\'-1\r\n\'@SUM(A1)\r\n',
    );
    // Numbers are numbers, not formulas.
    expect(toCsv(['n'], [[-1]])).toBe('﻿n\r\n-1\r\n');
  });
});

describe('export endpoints', () => {
  let app: FastifyInstance | undefined;
  let db: Db;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function setup() {
    db = openDatabase(':memory:');
    app = await buildApp({ config: { staticDir: undefined, logLevel: 'silent' }, db, scan: { now: () => '2026-10-14T18:00:00.000Z' } });
    upsertSeenDevice(db, info({}), '192.168.1.20', '2026-10-14T10:00:00.000Z');
    upsertSeenDevice(db, info({ mac: 'E868E7A1B2C3', gen: 1, model: 'SHSW-1', app: null, name: null, authRequired: true, raw: { type: 'SHSW-1' } }), '192.168.1.21', '2026-10-14T10:00:00.000Z');
    db.prepare("UPDATE devices SET location = 'Keller', notes = 'Sicherung F3; links\n=Achtung' WHERE mac = 'A8032AB12345'").run();
    insertSnapshot(db, { mac: 'A8032AB12345', takenAt: '2026-10-14T10:00:00.000Z', info: { v: 1 }, config: { sys: { device: { name: 'Alt' } } }, status: { s: 1 } });
    insertSnapshot(db, { mac: 'A8032AB12345', takenAt: '2026-10-14T11:00:00.000Z', info: { v: 2 }, config: { sys: { device: { name: 'Boiler' } } }, status: { s: 2 } });
    db.prepare(
      "INSERT INTO action_log (mac, action, requested_at, finished_at, result) VALUES ('A8032AB12345', 'factory_reset', '2026-10-14T12:00:00.000Z', '2026-10-14T12:00:01.000Z', 'ok')",
    ).run();
    db.prepare("UPDATE devices SET state = 'reset' WHERE mac = 'A8032AB12345'").run();
    return app;
  }

  it('exports JSON with the newest config per device as a download', async () => {
    const a = await setup();
    const res = await a.inject({ method: 'GET', url: '/api/export.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toBe('attachment; filename="shelly-inventar-2026-10-14.json"');

    const body = res.json<{ format: string; exportedAt: string; devices: { mac: string; snapshots: { config: unknown }[] }[] }>();
    expect(body).toMatchObject({ format: 'shelly-manager-inventory', version: 1, exportedAt: '2026-10-14T18:00:00.000Z', snapshots: 'latest' });
    const boiler = body.devices.find((d) => d.mac === 'A8032AB12345');
    expect(boiler).toMatchObject({
      macFormatted: 'A8:03:2A:B1:23:45', location: 'Keller', state: 'reset', factoryResetAt: '2026-10-14T12:00:01.000Z',
      snapshots: [{ takenAt: '2026-10-14T11:00:00.000Z', info: { v: 2 }, config: { sys: { device: { name: 'Boiler' } } }, status: { s: 2 } }],
    });
    expect(body.devices.find((d) => d.mac === 'E868E7A1B2C3')).toMatchObject({ authRequired: true, snapshots: [] });
  });

  it('exports all snapshots on request', async () => {
    const a = await setup();
    const body = (await a.inject({ method: 'GET', url: '/api/export.json?snapshots=all' })).json<{ devices: { mac: string; snapshots: { takenAt: string }[] }[] }>();
    expect(body.devices.find((d) => d.mac === 'A8032AB12345')?.snapshots.map((s) => s.takenAt)).toEqual([
      '2026-10-14T11:00:00.000Z',
      '2026-10-14T10:00:00.000Z',
    ]);
    expect((await a.inject({ method: 'GET', url: '/api/export.json?snapshots=some' })).statusCode).toBe(400);
  });

  it('exports a CSV overview for Excel', async () => {
    const a = await setup();
    const res = await a.inject({ method: 'GET', url: '/api/export.csv' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="shelly-inventar-2026-10-14.csv"');

    const text = res.body;
    expect(text.startsWith('﻿Name;Name auf Gerät;Modell;')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines).toHaveLength(4); // header, 2 devices, trailing empty
    expect(lines[1]).toBe(
      'Boiler;Boiler;SNSW-001P16EU;Plus1PM;2;192.168.1.20;A8:03:2A:B1:23:45;20241011-114455/1.4.4-g6d2a586;Keller;' +
        '"Sicherung F3; links\n=Achtung";Zurückgesetzt;nein;2026-10-14T10:00:00.000Z;2026-10-14T10:00:00.000Z;2026-10-14T11:00:00.000Z;2026-10-14T12:00:01.000Z;',
    );
    expect(lines[2]).toContain(';SHSW-1;;1;192.168.1.21;E8:68:E7:A1:B2:C3;');
    expect(lines[2]).toContain(';Aktiv;ja;');
  });
});
