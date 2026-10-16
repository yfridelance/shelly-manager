-- confirmed_at: last time the device answered with the same info/config as this snapshot.
-- A new snapshot row is only written when info or config changed; otherwise the newest row
-- gets the latest status_json and confirmed_at (see src/db/snapshots.ts). NULL = seen once.
ALTER TABLE config_snapshots ADD COLUMN confirmed_at TEXT;

-- Clean up the duplicates written before this migration: consecutive snapshots of a device with
-- identical info_json and config_json collapse into the oldest one (taken_at stays, confirmed_at
-- and status_json come from the newest). Rows referenced from action_log.details are never deleted;
-- they start a new segment and absorb the duplicates that follow them.
CREATE TEMP TABLE snapshot_refs AS
SELECT DISTINCT CAST(t.value AS INTEGER) AS id
FROM action_log a,
     json_tree(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END) t
WHERE a.details IS NOT NULL
  AND t.key IN ('snapshotId', 'snapshotAfterId')
  AND t.type = 'integer';

CREATE TEMP TABLE snapshot_segments AS
WITH ordered AS (
  SELECT id, mac, taken_at, status_json,
         (LAG(id) OVER w IS NULL
          OR config_json IS NOT LAG(config_json) OVER w
          OR info_json IS NOT LAG(info_json) OVER w
          OR id IN (SELECT id FROM snapshot_refs)) AS keep
  FROM config_snapshots
  WINDOW w AS (PARTITION BY mac ORDER BY taken_at, id)
)
SELECT id, mac, taken_at, status_json, keep,
       SUM(keep) OVER (PARTITION BY mac ORDER BY taken_at, id) AS seg
FROM ordered;

CREATE INDEX temp.idx_snapshot_segments ON snapshot_segments (mac, seg);

UPDATE config_snapshots
SET (confirmed_at, status_json) = (
  SELECT r.taken_at, r.status_json
  FROM snapshot_segments k
  JOIN snapshot_segments r ON r.mac = k.mac AND r.seg = k.seg
  WHERE k.id = config_snapshots.id
  ORDER BY r.taken_at DESC, r.id DESC
  LIMIT 1
)
WHERE id IN (
  SELECT k.id FROM snapshot_segments k
  WHERE k.keep AND EXISTS (SELECT 1 FROM snapshot_segments r WHERE r.mac = k.mac AND r.seg = k.seg AND NOT r.keep)
);

DELETE FROM config_snapshots WHERE id IN (SELECT id FROM snapshot_segments WHERE NOT keep);

DROP TABLE snapshot_segments;
DROP TABLE snapshot_refs;
