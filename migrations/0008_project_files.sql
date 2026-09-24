-- Reference files that belong to a whole project rather than one task (briefs, specs,
-- exports). Same shape as task_attachments; bytes live in R2, orphans drain via r2_orphans.
CREATE TABLE project_files (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_files_project ON project_files(project_id);
