-- Setting templates that can be applied to several devices (see src/templates/).
-- settings_json follows TemplateSettings; secrets (MQTT/AP passwords) are never stored here.
CREATE TABLE templates (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  description   TEXT,
  settings_json TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
