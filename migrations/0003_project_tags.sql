-- Free-form tags on projects (finance, business, income, hobby, ...). Mirrors task_labels.
-- Projects sharing a tag are treated as related, which is what lets Claude connect them.
CREATE TABLE project_tags (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (project_id, tag)
);
CREATE INDEX idx_project_tags_tag ON project_tags(tag);
