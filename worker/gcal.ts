import { importPKCS8, SignJWT } from "jose";
import type { Context } from "hono";
import type { Env } from "./index";

export class GcalError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type GcalTaskRow = {
  id: number;
  title: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
  gcal_event_id: string | null;
  project_name: string | null;
};

export type DesiredEvent = {
  summary: string;
  description: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
} | null;

export function addMinutes(date: string, time: string, mins: number): string {
  const d = new Date(`${date}T${time}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + mins);
  return d.toISOString().slice(0, 19);
}

export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Spec invariant: an event exists iff due_date is set AND status !== 'done'. */
export function desiredEvent(task: GcalTaskRow, tz: string): DesiredEvent {
  if (!task.due_date || task.status === "done") return null;
  const description = `Kanryo · ${task.project_name ?? "Inbox"}`;
  if (task.due_time) {
    return {
      summary: task.title,
      description,
      start: { dateTime: `${task.due_date}T${task.due_time}:00`, timeZone: tz },
      end: { dateTime: addMinutes(task.due_date, task.due_time, 30), timeZone: tz },
    };
  }
  return {
    summary: task.title,
    description,
    start: { date: task.due_date },
    end: { date: nextDay(task.due_date) },
  };
}

export type SyncActionKind = "create" | "patch" | "delete" | "none";

export function syncAction(hasEvent: boolean, desired: DesiredEvent): SyncActionKind {
  if (desired) return hasEvent ? "patch" : "create";
  return hasEvent ? "delete" : "none";
}

export function classifyGcalError(status: number): "auth" | "transient" {
  return status === 401 || status === 403 ? "auth" : "transient";
}

// ---------- settings helpers ----------

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).bind(key, value).run();
}

export async function recordSyncError(db: D1Database, err: unknown): Promise<void> {
  const cls = err instanceof GcalError ? classifyGcalError(err.status) : "transient";
  const message = err instanceof Error ? err.message : String(err);
  await setSetting(db, "gcal_error", JSON.stringify({ class: cls, message: message.slice(0, 500), at: new Date().toISOString() }));
}

export async function clearSyncError(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = 'gcal_error'").run();
}

// ---------- Google auth (service account JWT -> access token) ----------

let tokenCache: { token: string; exp: number } | null = null;

/** Expiry is checked on every call with a 60s margin (spec pin), never assumed from mint time. */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;
  if (!env.GCAL_CLIENT_EMAIL || !env.GCAL_PRIVATE_KEY) {
    throw new GcalError(401, "service account secrets not configured");
  }
  const key = await importPKCS8(env.GCAL_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/calendar.events" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(env.GCAL_CLIENT_EMAIL)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new GcalError(res.status, await res.text());
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, exp: now + data.expires_in };
  return data.access_token;
}

async function gcalFetch(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  const token = await getAccessToken(env);
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // A DELETE for an already-gone event is convergence, not failure.
  if (method === "DELETE" && (res.ok || res.status === 404 || res.status === 410)) return null;
  if (!res.ok) throw new GcalError(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

// ---------- convergence ----------

/**
 * Converge one task's calendar event to its desired state. Clears gcal_dirty only after
 * confirmed success; any throw leaves the flag set (it was written by the mutation itself).
 */
export async function syncTask(env: Env, taskId: number): Promise<void> {
  const calendarId = await getSetting(env.DB, "gcal_calendar_id");
  const row = await env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.due_date, t.due_time, t.gcal_event_id, p.name AS project_name
     FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
  ).bind(taskId).first<GcalTaskRow>();
  if (!row) return; // deleted meanwhile; gcal_orphans covers its event
  if (!calendarId) {
    // No calendar configured: nothing to converge; don't hold the task dirty forever.
    await env.DB.prepare("UPDATE tasks SET gcal_dirty = 0 WHERE id = ?").bind(taskId).run();
    return;
  }
  const tz = (await getSetting(env.DB, "gcal_timezone")) ?? "Europe/Berlin";
  const desired = desiredEvent(row, tz);
  const cal = encodeURIComponent(calendarId);
  switch (syncAction(!!row.gcal_event_id, desired)) {
    case "create": {
      const ev = await gcalFetch(env, "POST", `/calendars/${cal}/events`, desired);
      await env.DB.prepare("UPDATE tasks SET gcal_event_id = ?, gcal_dirty = 0 WHERE id = ?").bind(ev.id, taskId).run();
      break;
    }
    case "patch":
      await gcalFetch(env, "PATCH", `/calendars/${cal}/events/${row.gcal_event_id}`, desired);
      await env.DB.prepare("UPDATE tasks SET gcal_dirty = 0 WHERE id = ?").bind(taskId).run();
      break;
    case "delete":
      await gcalFetch(env, "DELETE", `/calendars/${cal}/events/${row.gcal_event_id}`);
      await env.DB.prepare("UPDATE tasks SET gcal_event_id = NULL, gcal_dirty = 0 WHERE id = ?").bind(taskId).run();
      break;
    case "none":
      await env.DB.prepare("UPDATE tasks SET gcal_dirty = 0 WHERE id = ?").bind(taskId).run();
      break;
  }
}

/** Delete calendar events for tasks that no longer exist. Row removed only after confirmed delete. */
export async function flushOrphans(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT gcal_event_id FROM gcal_orphans").all<{ gcal_event_id: string }>();
  if (results.length === 0) return 0;
  const calendarId = await getSetting(env.DB, "gcal_calendar_id");
  if (!calendarId) {
    await env.DB.prepare("DELETE FROM gcal_orphans").run();
    return results.length;
  }
  const cal = encodeURIComponent(calendarId);
  for (const { gcal_event_id } of results) {
    await gcalFetch(env, "DELETE", `/calendars/${cal}/events/${gcal_event_id}`);
    await env.DB.prepare("DELETE FROM gcal_orphans WHERE gcal_event_id = ?").bind(gcal_event_id).run();
  }
  return results.length;
}

/** App-load recovery pass: retry all dirty tasks and orphans. Success clears the error state. */
export async function syncPass(env: Env): Promise<{ synced: number; orphans: number; failed: number }> {
  const { results } = await env.DB.prepare("SELECT id FROM tasks WHERE gcal_dirty = 1").all<{ id: number }>();
  let synced = 0;
  let failed = 0;
  let lastError: unknown = null;
  for (const { id } of results) {
    try {
      await syncTask(env, id);
      synced++;
    } catch (err) {
      failed++;
      lastError = err;
    }
  }
  let orphans = 0;
  try {
    orphans = await flushOrphans(env);
  } catch (err) {
    failed++;
    lastError = err;
  }
  if (failed > 0) await recordSyncError(env.DB, lastError);
  else await clearSyncError(env.DB);
  return { synced, orphans, failed };
}

/** Fire-and-forget write-through sync for route handlers. */
export function queueSync(c: Context<{ Bindings: Env }>, taskId: number): void {
  c.executionCtx.waitUntil(
    syncTask(c.env, taskId)
      .then(() => clearSyncError(c.env.DB))
      .catch((err) => recordSyncError(c.env.DB, err)),
  );
}

/** Fire-and-forget orphan flush for delete handlers. */
export function queueOrphanFlush(c: Context<{ Bindings: Env }>): void {
  c.executionCtx.waitUntil(
    flushOrphans(c.env)
      .then(() => clearSyncError(c.env.DB))
      .catch((err) => recordSyncError(c.env.DB, err)),
  );
}
