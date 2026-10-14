import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

// Resolves to apps/server/migrations from both src/db (tsx) and dist/db (build).
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

const FILE_PATTERN = /^(\d+)_[\w-]+\.sql$/;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(dir: string): Migration[] {
  const migrations = fs
    .readdirSync(dir)
    .flatMap((name): Migration[] => {
      const match = FILE_PATTERN.exec(name);
      if (!match?.[1]) return [];
      return [{ version: Number(match[1]), name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }];
    })
    .sort((a, b) => a.version - b.version);

  for (let i = 1; i < migrations.length; i++) {
    if (migrations[i]?.version === migrations[i - 1]?.version) {
      throw new Error(`Duplicate migration version ${migrations[i]?.version}`);
    }
  }
  return migrations;
}

/** Applies all migrations not yet recorded in schema_migrations, each in its own transaction. Returns the applied file names. */
export function runMigrations(db: Database.Database, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .pluck()
      .all() as number[],
  );
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');

  const done: string[] = [];
  for (const migration of loadMigrations(dir)) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    })();
    done.push(migration.name);
  }
  return done;
}
