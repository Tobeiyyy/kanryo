-- Photos and files attached to tasks. Bytes live in R2; this table is the index.
CREATE TABLE task_attachments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_task ON task_attachments(task_id);

-- Objects whose task row is already gone; drained the same way gcal_orphans is.
CREATE TABLE r2_orphans (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
