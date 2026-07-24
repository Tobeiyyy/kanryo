-- Projects get a completion state, replacing archive entirely.
-- completed_at IS NOT NULL means finished; the vestigial status column is left alone.
ALTER TABLE projects ADD COLUMN completed_at TEXT;

-- Anything previously archived becomes completed, so no project can end up invisible.
UPDATE projects SET completed_at = datetime('now'), status = 'active' WHERE status = 'archived';
