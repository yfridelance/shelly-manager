-- Same cleanup as 008, but Gen1 configs are compared without the device clock (`time`, `unixtime`
-- in /settings), which changes on every read; see VOLATILE_GEN1_CONFIG_KEYS in src/db/snapshots.ts.
-- Gen1 = no `gen` in the /shelly answer. Stored configs stay raw (the oldest of a run is kept).
CREATE TEMP TABLE snapshot_refs AS
SELECT DISTINCT CAST(t.value AS INTEGER) AS id
FROM action_log a,
     json_tree(CASE WHEN json_valid(a.details) THEN a.details ELSE '{}' END) t
WHERE a.details IS NOT NULL
  AND t.key IN ('snapshotId', 'snapshotAfterId')
  AND t.type = 'integer';

CREATE TEMP TABLE snapshot_segments AS
WITH comparable AS (
  SELECT id, mac, taken_at, confirmed_at, status_json, info_json,
         CASE WHEN json_valid(info_json) AND json_extract(info_json, '$.gen') IS NULL
                   AND json_valid(config_json) AND json_type(config_json) = 'object'
              THEN json_remove(config_json, '$.time', '$.unixtime')
              ELSE config_json END AS config_cmp
  FROM config_snapshots
),
ordered AS (
  SELECT id, mac, taken_at, confirmed_at, status_json,
         (LAG(id) OVER w IS NULL
          OR config_cmp IS NOT LAG(config_cmp) OVER w
          OR info_json IS NOT LAG(info_json) OVER w
          OR id IN (SELECT id FROM snapshot_refs)) AS keep
  FROM comparable
  WINDOW w AS (PARTITION BY mac ORDER BY taken_at, id)
)
SELECT id, mac, taken_at, confirmed_at, status_json, keep,
       SUM(keep) OVER (PARTITION BY mac ORDER BY taken_at, id) AS seg
FROM ordered;

CREATE INDEX temp.idx_snapshot_segments ON snapshot_segments (mac, seg);

UPDATE config_snapshots
SET (confirmed_at, status_json) = (
  SELECT COALESCE(r.confirmed_at, r.taken_at), r.status_json
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
