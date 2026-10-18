-- Floor of a device («Stockwerk» in the UI, e.g. UG, EG, 1. OG, DG): local, free text like location and kind.
ALTER TABLE devices ADD COLUMN floor TEXT;
