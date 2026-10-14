-- requested_by: who triggered the action (client address; there are no user accounts).
-- details: JSON with action specifics, e.g. the pre-reset snapshot id or an explicit snapshot override.
ALTER TABLE action_log ADD COLUMN requested_by TEXT;
ALTER TABLE action_log ADD COLUMN details TEXT;
