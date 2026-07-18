import { Hono } from "hono";
import type { Env } from "./index";
import { getSetting, setSetting, syncPass } from "./gcal";

export const gcalRoutes = new Hono<{ Bindings: Env }>();

gcalRoutes.post("/sync", async (c) => c.json(await syncPass(c.env)));

gcalRoutes.get("/status", async (c) => {
  const [calendarId, timezone, errorRaw] = await Promise.all([
    getSetting(c.env.DB, "gcal_calendar_id"),
    getSetting(c.env.DB, "gcal_timezone"),
    getSetting(c.env.DB, "gcal_error"),
  ]);
  const dirty = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE gcal_dirty = 1").first<{ n: number }>();
  const orphans = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM gcal_orphans").first<{ n: number }>();
  return c.json({
    configured: !!(calendarId && c.env.GCAL_CLIENT_EMAIL),
    client_email: c.env.GCAL_CLIENT_EMAIL || null,
    calendar_id: calendarId,
    timezone: timezone ?? "Europe/Berlin",
    error: errorRaw ? JSON.parse(errorRaw) : null,
    dirty_count: dirty?.n ?? 0,
    orphan_count: orphans?.n ?? 0,
  });
});

gcalRoutes.put("/config", async (c) => {
  const body = await c.req.json<{ calendar_id?: string; timezone?: string }>();
  if ("calendar_id" in body) await setSetting(c.env.DB, "gcal_calendar_id", body.calendar_id?.trim() ?? "");
  if ("timezone" in body && body.timezone?.trim()) await setSetting(c.env.DB, "gcal_timezone", body.timezone.trim());
  return c.json({ ok: true });
});
