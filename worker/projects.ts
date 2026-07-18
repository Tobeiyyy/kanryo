import { Hono } from "hono";
import type { Env } from "./index";
import { queueOrphanFlush } from "./gcal";

type HonoEnv = { Bindings: Env };

export const projectRoutes = new Hono<HonoEnv>();
export const linkRoutes = new Hono<HonoEnv>();

const ACCENTS = ["teal", "coral", "violet", "blue", "amber", "rose", "green", "slate"];
const KINDS = ["repo", "live", "storage", "claude", "other"];

/** Fetch labels for a set of task rows and attach them as `labels: string[]`. */
export async function attachLabels(db: D1Database, tasks: any[]): Promise<any[]> {
  if (tasks.length === 0) return tasks;
  const ids = tasks.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db.prepare(
    `SELECT task_id, label FROM task_labels WHERE task_id IN (${placeholders}) ORDER BY label`,
  ).bind(...ids).all<{ task_id: number; label: string }>();
  const byTask = new Map<number, string[]>();
  for (const r of results) {
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, []);
    byTask.get(r.task_id)!.push(r.label);
  }
  return tasks.map((t) => ({ ...t, labels: byTask.get(t.id) ?? [] }));
}

projectRoutes.get("/", async (c) => {
  const status = c.req.query("archived") === "1" ? "archived" : "active";
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.description, p.accent, p.icon, p.status, p.created_at,
       COUNT(CASE WHEN t.status = 'consider' AND t.parent_id IS NULL THEN 1 END) AS consider_count,
       COUNT(CASE WHEN t.status = 'todo' AND t.parent_id IS NULL THEN 1 END) AS todo_count,
       COUNT(CASE WHEN t.status = 'done' AND t.parent_id IS NULL THEN 1 END) AS done_count,
       MIN(CASE WHEN t.status != 'done' THEN t.due_date END) AS next_due,
       COALESCE(MAX(t.updated_at), p.created_at) AS last_activity
     FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
     WHERE p.status = ?
     GROUP BY p.id
     ORDER BY last_activity DESC`,
  ).bind(status).all();
  return c.json(results);
});

projectRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string; accent?: string; icon?: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "name required" }, 400);
  const accent = ACCENTS.includes(body.accent ?? "") ? body.accent : "teal";
  const row = await c.env.DB.prepare(
    "INSERT INTO projects (name, description, accent, icon) VALUES (?, ?, ?, ?) RETURNING *",
  ).bind(name, body.description ?? null, accent, body.icon ?? null).first();
  return c.json(row, 201);
});

projectRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const project = await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  if (!project) return c.json({ error: "not found" }, 404);
  const links = (await c.env.DB.prepare(
    "SELECT * FROM project_links WHERE project_id = ? ORDER BY position, id",
  ).bind(id).all()).results;
  const tasks = (await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE project_id = ? ORDER BY status, position, id",
  ).bind(id).all()).results;
  return c.json({ project, links, tasks: await attachLabels(c.env.DB, tasks) });
});

const PROJECT_FIELDS = ["name", "description", "accent", "icon", "status"] as const;

projectRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();
  if ("accent" in body && !ACCENTS.includes(body.accent as string)) return c.json({ error: "bad accent" }, 400);
  if ("status" in body && !["active", "archived"].includes(body.status as string)) return c.json({ error: "bad status" }, 400);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of PROJECT_FIELDS) {
    if (f in body) { sets.push(`${f} = ?`); values.push(body[f]); }
  }
  if (sets.length === 0) return c.json({ error: "empty patch" }, 400);
  const row = await c.env.DB.prepare(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
  ).bind(...values, id).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

projectRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  // Same-batch tombstones (spec: failure state written first): capture every event id this
  // cascade will destroy, then delete. flushOrphans reconciles the calendar afterwards.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO gcal_orphans (gcal_event_id)
       SELECT gcal_event_id FROM tasks WHERE project_id = ? AND gcal_event_id IS NOT NULL`,
    ).bind(id),
    c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id),
  ]);
  queueOrphanFlush(c);
  return c.json({ ok: true });
});

projectRoutes.post("/:id/links", async (c) => {
  const projectId = Number(c.req.param("id"));
  const body = await c.req.json<{ label?: string; url?: string; kind?: string }>();
  if (!body.label?.trim() || !body.url?.trim()) return c.json({ error: "label and url required" }, 400);
  const kind = KINDS.includes(body.kind ?? "") ? body.kind : "other";
  const row = await c.env.DB.prepare(
    `INSERT INTO project_links (project_id, label, url, kind, position)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM project_links WHERE project_id = ?))
     RETURNING *`,
  ).bind(projectId, body.label.trim(), body.url.trim(), kind, projectId).first();
  return c.json(row, 201);
});

const LINK_FIELDS = ["label", "url", "kind", "position"] as const;

linkRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<Record<string, unknown>>();
  if ("kind" in body && !KINDS.includes(body.kind as string)) return c.json({ error: "bad kind" }, 400);
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of LINK_FIELDS) {
    if (f in body) { sets.push(`${f} = ?`); values.push(body[f]); }
  }
  if (sets.length === 0) return c.json({ error: "empty patch" }, 400);
  const row = await c.env.DB.prepare(
    `UPDATE project_links SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
  ).bind(...values, id).first();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

linkRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM project_links WHERE id = ?").bind(Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});
