-- Rename the first task state from 'consider' to 'review', so the stored value matches the
-- column the UI calls "To review". SQLite cannot alter a CHECK constraint, so tasks has to be
-- rebuilt.
--
-- The obvious rebuild (create new, copy, DROP TABLE tasks, rename) destroys data: DROP TABLE
-- runs an implicit DELETE FROM, which fires every ON DELETE CASCADE aimed at tasks. That wipes
-- task_labels and task_attachments and cascade-deletes subtasks. So the children are copied
-- aside and their tables dropped BEFORE tasks, then everything is rebuilt and refilled.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE _bk_tasks AS SELECT * FROM tasks;
CREATE TABLE _bk_task_labels AS SELECT * FROM task_labels;
CREATE TABLE _bk_task_attachments AS SELECT * FROM task_attachments;

DROP TABLE task_labels;
DROP TABLE task_attachments;
DROP TABLE tasks;

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('review','todo','done')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  due_date TEXT,
  due_time TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  gcal_event_id TEXT,
  gcal_dirty INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- Parents before children, so the self-reference is satisfied row by row.
INSERT INTO tasks (
  id, project_id, parent_id, title, notes, status, priority, due_date, due_time,
  position, gcal_event_id, gcal_dirty, created_at, updated_at, completed_at
)
SELECT
  id, project_id, parent_id, title, notes,
  CASE status WHEN 'consider' THEN 'review' ELSE status END,
  priority, due_date, due_time,
  position, gcal_event_id, gcal_dirty, created_at, updated_at, completed_at
FROM _bk_tasks
ORDER BY (parent_id IS NOT NULL), id;

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);

CREATE TABLE task_labels (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  PRIMARY KEY (task_id, label)
);
INSERT INTO task_labels (task_id, label) SELECT task_id, label FROM _bk_task_labels;

CREATE TABLE task_attachments (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO task_attachments (id, task_id, key, filename, content_type, size, created_at)
SELECT id, task_id, key, filename, content_type, size, created_at FROM _bk_task_attachments;
CREATE INDEX idx_attachments_task ON task_attachments(task_id);

DROP TABLE _bk_tasks;
DROP TABLE _bk_task_labels;
DROP TABLE _bk_task_attachments;
