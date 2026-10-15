-- Newer firmware offered by the device (from status on every scan/snapshot, or an explicit check).
-- Gen1: firmware id, Gen2+: version. NULL = none known.
ALTER TABLE devices ADD COLUMN update_stable TEXT;
ALTER TABLE devices ADD COLUMN update_beta TEXT;
ALTER TABLE devices ADD COLUMN update_checked_at TEXT;
