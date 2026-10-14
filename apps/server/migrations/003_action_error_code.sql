-- Stable error code next to the technical message, so the UI can show German text.
ALTER TABLE action_log ADD COLUMN error_code TEXT;
