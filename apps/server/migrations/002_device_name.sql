-- `name` is the local display name (editable, never written to the device).
-- `device_name` is what the device itself reports. A scan updates `name` only while the user
-- has not changed it locally (name still equals device_name), so local edits survive rescans.
ALTER TABLE devices ADD COLUMN device_name TEXT;
UPDATE devices SET device_name = name;
