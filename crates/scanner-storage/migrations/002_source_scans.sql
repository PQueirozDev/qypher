CREATE TABLE source_scans (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX source_scans_date ON source_scans(started_at DESC);
PRAGMA user_version = 2;
