import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';
import { backfillFunctions } from './snapshots.js';

export type Db = Database.Database;

/** Opens (or creates) the SQLite database and applies pending migrations. Pass ':memory:' for tests. */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  backfillFunctions(db);
  return db;
}
