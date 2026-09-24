import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./index";

type HonoEnv = { Bindings: Env };

export const attachmentRoutes = new Hono<HonoEnv>();

const MAX_BYTES = 15 * 1024 * 1024;

/** Object key: task-scoped so a task's files are easy to sweep, with a random suffix. */
export function attachmentKey(taskId: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
  return `tasks/${taskId}/${crypto.randomUUID()}-${safe}`;
}

export function projectFileKey(projectId: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
  return `projects/${projectId}/${crypto.randomUUID()}-${safe}`;
}

export async function listAttachments(db: D1Database, taskId: number): Promise<any[]> {
  const { results } = await db.prepare(
    "SELECT id, task_id, filename, content_type, size, created_at FROM task_attachments WHERE task_id = ? ORDER BY id",
  ).bind(taskId).all();
  return results;
}

export async function listProjectFiles(db: D1Database, projectId: number): Promise<any[]> {
  const { results } = await db.prepare(
    "SELECT id, project_id, filename, content_type, size, created_at FROM project_files WHERE project_id = ? ORDER BY id",
  ).bind(projectId).all();
  return results;
}

/**
 * Delete the R2 objects belonging to a set of tasks. Keys are tombstoned in r2_orphans first
 * (same failure-state-first rule as the calendar sync) so a failed delete can be retried
 * instead of leaking bytes forever.
 */
export async function purgeTaskFiles(c: Context<{ Bindings: Env }>, taskIds: number[]): Promise<void> {
  if (taskIds.length === 0) return;
  const placeholders = taskIds.map(() => "?").join(",");
  const { results } = await c.env.DB.prepare(
    `SELECT key FROM task_attachments WHERE task_id IN (${placeholders})`,
  ).bind(...taskIds).all<{ key: string }>();
  await tombstone(c, results);
}

/** Same sweep for a project's own files, before the project row (and its cascade) goes. */
export async function purgeProjectFiles(c: Context<{ Bindings: Env }>, projectId: number): Promise<void> {
  const { results } = await c.env.DB.prepare("SELECT key FROM project_files WHERE project_id = ?")
    .bind(projectId).all<{ key: string }>();
  await tombstone(c, results);
}

async function tombstone(c: Context<{ Bindings: Env }>, rows: { key: string }[]): Promise<void> {
  if (rows.length === 0) return;
  await c.env.DB.batch(
    rows.map((r) => c.env.DB.prepare("INSERT OR IGNORE INTO r2_orphans (key) VALUES (?)").bind(r.key)),
  );
  c.executionCtx.waitUntil(flushR2Orphans(c.env));
}

export async function flushR2Orphans(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT key FROM r2_orphans").all<{ key: string }>();
  let done = 0;
  for (const { key } of results) {
    await env.BUCKET.delete(key);
    await env.DB.prepare("DELETE FROM r2_orphans WHERE key = ?").bind(key).run();
    done++;
  }
  return done;
}

type FileRow = { key: string; filename: string; content_type: string };

/** Upload body: raw bytes, filename in the x-filename header, type in content-type. */
async function readUpload(c: Context<HonoEnv>) {
  const filename = decodeURIComponent(c.req.header("x-filename") ?? "file");
  const contentType = c.req.header("content-type") ?? "application/octet-stream";
  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return { error: "empty file", status: 400 as const };
  if (body.byteLength > MAX_BYTES) return { error: "file too large (max 15 MB)", status: 413 as const };
  return { body, filename, contentType };
}

/** Same-origin <img> requests carry the auth cookie, so serving stays guarded. */
async function serveFile(c: Context<HonoEnv>, row: FileRow | null): Promise<Response> {
  if (!row) return c.json({ error: "not found" }, 404);
  const object = await c.env.BUCKET.get(row.key);
  if (!object) return c.json({ error: "file missing" }, 404);
  const disposition = c.req.query("download") === "1" ? "attachment" : "inline";
  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "content-disposition": `${disposition}; filename="${row.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}

async function removeFile(c: Context<HonoEnv>, table: "task_attachments" | "project_files", id: number) {
  const row = await c.env.DB.prepare(`SELECT key FROM ${table} WHERE id = ?`).bind(id).first<{ key: string }>();
  if (!row) return c.json({ error: "not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO r2_orphans (key) VALUES (?)").bind(row.key),
    c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id),
  ]);
  c.executionCtx.waitUntil(flushR2Orphans(c.env));
  return c.json({ ok: true });
}

attachmentRoutes.post("/tasks/:id/attachments", async (c) => {
  const taskId = Number(c.req.param("id"));
  const task = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ?").bind(taskId).first();
  if (!task) return c.json({ error: "task not found" }, 404);
  const up = await readUpload(c);
  if ("error" in up) return c.json({ error: up.error }, up.status);

  const key = attachmentKey(taskId, up.filename);
  await c.env.BUCKET.put(key, up.body, { httpMetadata: { contentType: up.contentType } });
  const row = await c.env.DB.prepare(
    `INSERT INTO task_attachments (task_id, key, filename, content_type, size)
     VALUES (?, ?, ?, ?, ?) RETURNING id, task_id, filename, content_type, size, created_at`,
  ).bind(taskId, key, up.filename, up.contentType, up.body.byteLength).first();
  await c.env.DB.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").bind(taskId).run();
  return c.json(row, 201);
});

attachmentRoutes.get("/tasks/:id/attachments", async (c) => {
  return c.json(await listAttachments(c.env.DB, Number(c.req.param("id"))));
});

attachmentRoutes.get("/attachments/:id", async (c) => {
  return serveFile(c, await c.env.DB.prepare(
    "SELECT key, filename, content_type FROM task_attachments WHERE id = ?",
  ).bind(Number(c.req.param("id"))).first<FileRow>());
});

attachmentRoutes.delete("/attachments/:id", (c) => removeFile(c, "task_attachments", Number(c.req.param("id"))));

attachmentRoutes.post("/projects/:id/files", async (c) => {
  const projectId = Number(c.req.param("id"));
  const project = await c.env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(projectId).first();
  if (!project) return c.json({ error: "project not found" }, 404);
  const up = await readUpload(c);
  if ("error" in up) return c.json({ error: up.error }, up.status);

  const key = projectFileKey(projectId, up.filename);
  await c.env.BUCKET.put(key, up.body, { httpMetadata: { contentType: up.contentType } });
  const row = await c.env.DB.prepare(
    `INSERT INTO project_files (project_id, key, filename, content_type, size)
     VALUES (?, ?, ?, ?, ?) RETURNING id, project_id, filename, content_type, size, created_at`,
  ).bind(projectId, key, up.filename, up.contentType, up.body.byteLength).first();
  return c.json(row, 201);
});

attachmentRoutes.get("/projects/:id/files", async (c) => {
  return c.json(await listProjectFiles(c.env.DB, Number(c.req.param("id"))));
});

attachmentRoutes.get("/project-files/:id", async (c) => {
  return serveFile(c, await c.env.DB.prepare(
    "SELECT key, filename, content_type FROM project_files WHERE id = ?",
  ).bind(Number(c.req.param("id"))).first<FileRow>());
});

attachmentRoutes.delete("/project-files/:id", (c) => removeFile(c, "project_files", Number(c.req.param("id"))));
