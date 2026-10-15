import type { TemplateSettings } from '../templates/settings.js';
import type { Db } from './database.js';

export interface TemplateRow {
  id: number;
  name: string;
  description: string | null;
  settings_json: string;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: number;
  name: string;
  description: string | null;
  settings: TemplateSettings;
  createdAt: string;
  updatedAt: string;
}

export class TemplateNameTakenError extends Error {
  override name = 'TemplateNameTakenError';
}

function toTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    settings: JSON.parse(row.settings_json) as TemplateSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rethrowUnique(err: unknown, name: string): never {
  if (err instanceof Error && /UNIQUE constraint failed: templates.name/.test(err.message)) {
    throw new TemplateNameTakenError(`Template name "${name}" is already used`);
  }
  throw err;
}

export function listTemplates(db: Db): Template[] {
  return (db.prepare('SELECT * FROM templates ORDER BY name COLLATE NOCASE').all() as TemplateRow[]).map(toTemplate);
}

export function getTemplate(db: Db, id: number): Template | undefined {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
  return row ? toTemplate(row) : undefined;
}

export function createTemplate(db: Db, t: { name: string; description: string | null; settings: TemplateSettings }, now: string): Template {
  try {
    const res = db
      .prepare('INSERT INTO templates (name, description, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(t.name, t.description, JSON.stringify(t.settings), now, now);
    return getTemplate(db, Number(res.lastInsertRowid)) as Template;
  } catch (err) {
    return rethrowUnique(err, t.name);
  }
}

export function updateTemplate(
  db: Db,
  id: number,
  t: { name: string; description: string | null; settings: TemplateSettings },
  now: string,
): Template | undefined {
  try {
    const res = db
      .prepare('UPDATE templates SET name = ?, description = ?, settings_json = ?, updated_at = ? WHERE id = ?')
      .run(t.name, t.description, JSON.stringify(t.settings), now, id);
    return res.changes > 0 ? getTemplate(db, id) : undefined;
  } catch (err) {
    return rethrowUnique(err, t.name);
  }
}

/** Templates are only recipes; the action log keeps the name of every applied template. */
export function deleteTemplate(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
}
