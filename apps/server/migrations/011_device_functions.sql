-- What a device does (switch, cover, light, energy meter …), derived from the newest snapshot
-- as JSON (src/devices/functions.ts), plus a free local field for what is connected ("Typ" in the UI).
-- Existing devices get their functions at the next start from their newest snapshot (openDatabase).
ALTER TABLE devices ADD COLUMN functions TEXT;
ALTER TABLE devices ADD COLUMN kind TEXT;
