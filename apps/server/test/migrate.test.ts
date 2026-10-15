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
