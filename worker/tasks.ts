import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./index";
import { buildTaskPatch, defaultStatus, touchesGcal, STATUSES, type TaskPatchBody } from "./taskLogic";
import { queueOrphanFlush, queueSync } from "./gcal";
import { purgeTaskFiles } from "./attachments";
import { attachLabels } from "./projects";

type HonoEnv = { Bindings: Env };

export const taskRoutes = new Hono<HonoEnv>();
export const inboxRoutes = new Hono<HonoEnv>();

inboxRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM tasks WHERE project_id IS NULL ORDER BY created_at DESC, id DESC",
  ).all();
  return c.json(await attachLabels(c.env.DB, results));
});

export type CreateTaskBody = TaskPatchBody & { title?: string };

/** Shared insert path for the REST route and the MCP tools — one source of truth
    for validation, status default, born-dirty gcal flag, position, labels, sync. */
export async function createTask(
  c: Context<{ Bindings: Env }>, body: CreateTaskBody,
): Promise<{ task?: any; error?: string }> {
  const title = body.title?.trim();
  if (!title) return { error: "title required" };
  if (body.status !== undefined && !STATUSES.includes(body.status)) return { error: "bad status" };
  const status = defaultStatus(body);
  // due date present -> event desired -> born dirty (failure state precedes the sync attempt)
  const dirty = body.due_date ? 1 : 0;
  const row = await c.env.DB.prepare(
    `INSERT INTO tasks (project_id, parent_id, title, notes, status, priority, due_date, due_time, gcal_dirty, position)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
       (SELECT COALESCE(MAX(position) + 1, 0) FROM tasks WHERE project_id IS ?1 AND status = ?5))
     RETURNING *`,
  ).bind(
    body.project_id ?? null, body.parent_id ?? null, title, body.notes ?? null,
    status, body.priority ?? 0, body.due_date ?? null, body.due_time ?? null, dirty,
  ).first<any>();
  if (body.labels?.length) {
    await c.env.DB.batch(body.labels.map((l) =>
      c.env.DB.prepare("INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)").bind(row.id, l),
    ));
  }
  if (dirty) queueSync(c, row.id);
  return { task: { ...row, labels: body.labels ?? [] } };
}

taskRoutes.get("/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(Number(c.req.param("id"))).first<any>();
  if (!row) return c.json({ error: "not found" }, 404);
  const [withLabels] = await attachLabels(c.env.DB, [row]);
  return c.json(withLabels);
});

taskRoutes.post("/", async (c) => {
  const result = await createTask(c, await c.req.json<CreateTaskBody>());
  if (result.error) return c.json({ error: result.error }, 400);
  return c.json(result.task, 201);
});

taskRoutes.post("/positions", async (c) => {
  const body = await c.req.json<{ project_id?: number | null; status?: string; ids?: number[] }>();
  // Spec pin: inbox has no manual order.
  if (body.project_id == null) return c.json({ error: "inbox has no manual order" }, 400);
  if (!body.status || !STATUSES.includes(body.status as never) || !Array.isArray(body.ids)) {
    return c.json({ error: "status and ids required" }, 400);
  }
  await c.env.DB.batch(body.ids.map((taskId, i) =>
    c.env.DB.prepare(
      "UPDATE tasks SET position = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?",
    ).bind(i, taskId, body.project_id),
  ));
  return c.json({ ok: true });
});

/** Shared update path for the REST route and the MCP tools — presence-based patch,
    gcal dirty-first flagging, label replacement. Mirrors createTask. */
export async function patchTask(
  c: Context<{ Bindings: Env }>, id: number, body: TaskPatchBody,
): Promise<{ task?: any; error?: string }> {
  if ("status" in body && !STATUSES.includes(body.status!)) return { error: "bad status" };
  const { sets, values, labels } = buildTaskPatch(body);
  const dirty = touchesGcal(body);
  if (dirty) sets.push("gcal_dirty = 1");
  sets.push("updated_at = datetime('now')");
  const row = await c.env.DB.prepare(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
  ).bind(...values, id).first<any>();
  if (!row) return { error: "not found" };
  if (labels !== undefined) {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM task_labels WHERE task_id = ?").bind(id),
      ...labels.map((l) => c.env.DB.prepare("INSERT INTO task_labels (task_id, label) VALUES (?, ?)").bind(id, l)),
    ]);
  }
  if (dirty) queueSync(c, id);
  const [withLabels] = await attachLabels(c.env.DB, [row]);
  return { task: withLabels };
}

taskRoutes.patch("/:id", async (c) => {
  const result = await patchTask(c, Number(c.req.param("id")), await c.req.json<TaskPatchBody>());
  if (result.error) return c.json({ error: result.error }, result.error === "not found" ? 404 : 400);
  return c.json(result.task);
});

/** Shared delete path for the REST route and the MCP tools. Reports the removed row so
    callers can echo what went away; returns an error when the id doesn't exist. */
export async function deleteTask(
  c: Context<{ Bindings: Env }>, id: number,
): Promise<{ task?: { id: number; title: string }; error?: string }> {
  const row = await c.env.DB.prepare("SELECT id, title FROM tasks WHERE id = ?")
    .bind(id).first<{ id: number; title: string }>();
  if (!row) return { error: "not found" };
  // Attachments of this task and its descendants: the rows cascade away, the R2 objects don't.
  const { results: descendants } = await c.env.DB.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM tasks WHERE id = ?1
       UNION ALL
       SELECT t.id FROM tasks t JOIN sub s ON t.parent_id = s.id
     ) SELECT id FROM sub`,
  ).bind(id).all<{ id: number }>();
  await purgeTaskFiles(c, descendants.map((d) => d.id));
  // Tombstone the event ids of this task AND its descendants (cascade will delete their rows)
  // in the same batch as the delete itself — spec: failure state written first.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM tasks WHERE id = ?1
         UNION ALL
         SELECT t.id FROM tasks t JOIN sub s ON t.parent_id = s.id
       )
       INSERT OR IGNORE INTO gcal_orphans (gcal_event_id)
       SELECT gcal_event_id FROM tasks WHERE id IN (SELECT id FROM sub) AND gcal_event_id IS NOT NULL`,
    ).bind(id),
    c.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id),
  ]);
  queueOrphanFlush(c);
  return { task: row };
}

taskRoutes.delete("/:id", async (c) => {
  await deleteTask(c, Number(c.req.param("id")));
  return c.json({ ok: true });
});
