import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { MIGRATIONS_DIR, runMigrations } from '../src/db/migrate.js';

describe('migrations', () => {
  it('creates the MVP tables', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual(expect.arrayContaining(['action_log', 'config_snapshots', 'devices', 'schema_migrations']));
    db.close();
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    expect(runMigrations(db).length).toBeGreaterThan(0);
    expect(runMigrations(db)).toEqual([]);
    db.close();
  });

  it('applies only new migrations, in numeric order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-mig-'));
    try {
      for (const f of fs.readdirSync(MIGRATIONS_DIR)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
      const db = new Database(':memory:');
      runMigrations(db, dir);

      fs.writeFileSync(path.join(dir, '910_later.sql'), 'CREATE TABLE later (id INTEGER);');
      fs.writeFileSync(path.join(dir, '900_next.sql'), 'CREATE TABLE next_one (id INTEGER);');
      expect(runMigrations(db, dir)).toEqual(['900_next.sql', '910_later.sql']);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backfills device ids from existing snapshots (migration 007)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-mig7-'));
    try {
      for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '007')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
      const db = new Database(':memory:');
      runMigrations(db, dir);
      const now = '2026-10-14T10:00:00.000Z';
      const dev = db.prepare('INSERT INTO devices (mac, gen, first_seen, last_seen) VALUES (?, ?, ?, ?)');
      const snap = db.prepare('INSERT INTO config_snapshots (mac, taken_at, info_json, config_json) VALUES (?, ?, ?, ?)');
      dev.run('E868E7A1B2C3', 1, now, now);
      dev.run('A8032AB12345', 2, now, now);
      dev.run('000000000001', 2, now, now);
      snap.run('E868E7A1B2C3', now, '{"type":"SHSW-1"}', '{"device":{"hostname":"shelly1-A1B2C3"}}');
      snap.run('A8032AB12345', '2026-10-13T10:00:00.000Z', '{"id":"old-id"}', null);
      snap.run('A8032AB12345', now, '{"id":"shellyplus1pm-a8032ab12345"}', null);

      fs.copyFileSync(path.join(MIGRATIONS_DIR, '007_device_id.sql'), path.join(dir, '007_device_id.sql'));
      expect(runMigrations(db, dir)).toEqual(['007_device_id.sql']);
      expect(db.prepare('SELECT mac, device_id FROM devices ORDER BY mac').all()).toEqual([
        { mac: '000000000001', device_id: null },
        { mac: 'A8032AB12345', device_id: 'shellyplus1pm-a8032ab12345' },
        { mac: 'E868E7A1B2C3', device_id: 'shelly1-A1B2C3' },
      ]);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges consecutive duplicate snapshots but keeps referenced ones (migrations 008/009)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-mig8-'));
    try {
      for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '008')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
      const db = new Database(':memory:');
      runMigrations(db, dir);
      const at = (h: number) => `2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`;
      const dev = db.prepare('INSERT INTO devices (mac, gen, first_seen, last_seen) VALUES (?, ?, ?, ?)');
      dev.run('A8032AB12345', 2, at(0), at(0));
      dev.run('E868E7A1B2C3', 1, at(0), at(0));
      const snap = db.prepare('INSERT INTO config_snapshots (id, mac, taken_at, info_json, config_json, status_json) VALUES (?, ?, ?, ?, ?, ?)');
      const rpc = (id: number, h: number, config: string) => snap.run(id, 'A8032AB12345', at(h), '{"gen":2}', config, `{"uptime":${h}}`);
      rpc(1, 1, '{"a":1}');
      rpc(2, 2, '{"a":1}');
      rpc(3, 3, '{"a":1}'); // referenced: stays and absorbs 4
      rpc(4, 4, '{"a":1}');
      rpc(5, 5, '{"a":2}');
      rpc(6, 6, '{"a":1}'); // same as 1, but not consecutive: stays
      rpc(7, 7, '{"a":1}');
      const gen1 = (id: number, h: number, config: string) => snap.run(id, 'E868E7A1B2C3', at(h), '{"type":"SHSW-1"}', config, '{}');
      gen1(10, 1, `{"x":1,"time":"01:00","unixtime":1}`);
      gen1(11, 2, `{"x":1,"time":"02:00","unixtime":2}`);
      gen1(12, 3, `{"x":2,"time":"03:00","unixtime":3}`);
      const log = db.prepare("INSERT INTO action_log (mac, action, requested_at, details) VALUES ('A8032AB12345', ?, ?, ?)");
      log.run('apply_template', at(3), '{"snapshotId":3,"snapshotAfterId":5}');
      log.run('snapshot', at(3), 'not json');
      log.run('reboot', at(3), null);

      for (const f of ['008_snapshot_dedupe.sql', '009_snapshot_dedupe_gen1.sql']) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
      expect(runMigrations(db, dir)).toEqual(['008_snapshot_dedupe.sql', '009_snapshot_dedupe_gen1.sql']);
      expect(db.prepare('SELECT id, taken_at, confirmed_at, config_json, status_json FROM config_snapshots ORDER BY id').all()).toEqual([
        { id: 1, taken_at: at(1), confirmed_at: at(2), config_json: '{"a":1}', status_json: '{"uptime":2}' },
        { id: 3, taken_at: at(3), confirmed_at: at(4), config_json: '{"a":1}', status_json: '{"uptime":4}' },
        { id: 5, taken_at: at(5), confirmed_at: null, config_json: '{"a":2}', status_json: '{"uptime":5}' },
        { id: 6, taken_at: at(6), confirmed_at: at(7), config_json: '{"a":1}', status_json: '{"uptime":7}' },
        { id: 10, taken_at: at(1), confirmed_at: at(2), config_json: '{"x":1,"time":"01:00","unixtime":1}', status_json: '{}' },
        { id: 12, taken_at: at(3), confirmed_at: null, config_json: '{"x":2,"time":"03:00","unixtime":3}', status_json: '{}' },
      ]);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces the device state and gen constraints', () => {
    const db = openDatabase(':memory:');
    const now = new Date().toISOString();
    const insert = db.prepare(
      'INSERT INTO devices (mac, gen, state, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)',
    );
    insert.run('AABBCCDDEEFF', 2, 'active', now, now);
    expect(() => insert.run('AABBCCDDEE00', 5, 'active', now, now)).toThrow();
    expect(() => insert.run('AABBCCDDEE01', 1, 'gone', now, now)).toThrow();
    db.close();
  });

  it('persists data across reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelly-db-'));
    try {
      const file = path.join(dir, 'nested', 'db.sqlite');
      const now = new Date().toISOString();
      const db = openDatabase(file);
      db.prepare('INSERT INTO devices (mac, gen, location, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)').run(
        'AABBCCDDEEFF',
        1,
        'Keller',
        now,
        now,
      );
      db.close();

      const reopened = openDatabase(file);
      expect(reopened.prepare('SELECT location FROM devices WHERE mac = ?').pluck().get('AABBCCDDEEFF')).toBe('Keller');
      reopened.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
