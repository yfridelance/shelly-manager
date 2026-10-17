-- Sites: separate inventories (houses, customers) in one installation. Every device, template and
-- log entry belongs to exactly one site; existing data goes to the default site 1 "Standard".
-- No REFERENCES clause on the new columns: SQLite only allows that for ADD COLUMN with default NULL
-- while foreign keys are on. The app keeps the reference valid (a site can only be deleted when empty).
CREATE TABLE sites (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL
);
INSERT INTO sites (id, name, created_at) VALUES (1, 'Standard', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

ALTER TABLE devices ADD COLUMN site_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX idx_devices_site ON devices (site_id);
-- IPs are only unique within a site (separate networks may use the same ranges).
CREATE INDEX idx_devices_site_ip ON devices (site_id, ip);

ALTER TABLE action_log ADD COLUMN site_id INTEGER;
UPDATE action_log SET site_id = COALESCE((SELECT d.site_id FROM devices d WHERE d.mac = action_log.mac), 1);
CREATE INDEX idx_action_log_site ON action_log (site_id);

-- Template names are unique per site: rebuild the table (SQLite cannot drop a UNIQUE constraint).
CREATE TABLE templates_new (
  id            INTEGER PRIMARY KEY,
  site_id       INTEGER NOT NULL DEFAULT 1,
  name          TEXT NOT NULL,
  description   TEXT,
  settings_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (site_id, name)
);
INSERT INTO templates_new (id, site_id, name, description, settings_json, created_at, updated_at)
  SELECT id, 1, name, description, settings_json, created_at, updated_at FROM templates;
DROP TABLE templates;
ALTER TABLE templates_new RENAME TO templates;
