-- Shelly device id: Gen2+ `id` from /shelly (e.g. "shellyplus1pm-a8032ab12345"),
-- Gen1 hostname from /settings (e.g. "shelly1-A1B2C3"; needs credentials on protected devices).
ALTER TABLE devices ADD COLUMN device_id TEXT;

-- Backfill from the newest snapshot of each device.
UPDATE devices SET device_id = (
  SELECT CASE WHEN devices.gen = 1
              THEN json_extract(s.config_json, '$.device.hostname')
              ELSE json_extract(s.info_json, '$.id') END
  FROM config_snapshots s
  WHERE s.mac = devices.mac
  ORDER BY s.taken_at DESC, s.id DESC
  LIMIT 1
);
