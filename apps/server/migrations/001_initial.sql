-- Initial schema. See AGENTS.md section 7.
-- The MAC (uppercase, no separators) is the device identity; the IP is just the last known address.

CREATE TABLE devices (
  mac           TEXT PRIMARY KEY,
  ip            TEXT,
  gen           INTEGER NOT NULL CHECK (gen IN (1, 2, 3, 4)),
  model         TEXT,
  app           TEXT,
  firmware      TEXT,
  name          TEXT,
  auth_required INTEGER NOT NULL DEFAULT 0 CHECK (auth_required IN (0, 1)),
  location      TEXT,
  notes         TEXT,
  state         TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'reset', 'missing')),
  first_seen    TEXT NOT NULL,
  last_seen     TEXT NOT NULL
);

CREATE INDEX idx_devices_ip ON devices (ip);

CREATE TABLE config_snapshots (
  id          INTEGER PRIMARY KEY,
  mac         TEXT NOT NULL REFERENCES devices (mac),
  taken_at    TEXT NOT NULL,
  info_json   TEXT NOT NULL,
  config_json TEXT,
  status_json TEXT
);

CREATE INDEX idx_config_snapshots_mac_taken_at ON config_snapshots (mac, taken_at);

-- No foreign key on mac: the log must also record attempts against unknown MACs.
CREATE TABLE action_log (
  id           INTEGER PRIMARY KEY,
  mac          TEXT NOT NULL,
  action       TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  finished_at  TEXT,
  result       TEXT CHECK (result IS NULL OR result IN ('ok', 'error')),
  error        TEXT
);

CREATE INDEX idx_action_log_mac ON action_log (mac);
CREATE INDEX idx_action_log_requested_at ON action_log (requested_at);
