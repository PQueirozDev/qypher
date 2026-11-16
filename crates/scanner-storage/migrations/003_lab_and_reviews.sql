CREATE TABLE lab_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX lab_runs_project_date ON lab_runs(project_id, started_at DESC);
CREATE TABLE source_reviews (
  scan_id TEXT NOT NULL REFERENCES source_scans(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('false_positive')),
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY(scan_id, finding_id)
);
PRAGMA user_version = 3;
