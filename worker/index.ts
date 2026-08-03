import { Hono } from "hono";
import { authMiddleware, setAuthCookie, clearAuthCookie, hmac } from "./auth";
import { projectRoutes, linkRoutes } from "./projects";
import { taskRoutes, inboxRoutes } from "./tasks";
import { gcalRoutes } from "./gcalRoutes";
import { mcpRoutes } from "./mcp";
import { attachmentRoutes } from "./attachments";
import { habitRoutes } from "./habits";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD: string;
  AUTH_SECRET: string;
  GCAL_CLIENT_EMAIL: string;
  GCAL_PRIVATE_KEY: string;
  KANRYO_TOKEN: string;
  BUCKET: R2Bucket;
};

export type App = Hono<{ Bindings: Env }>;

const app: App = new Hono();

// Shared malformed-JSON / unexpected-error guard. Logs only the message, never bodies.
app.onError((err, c) => {
  if (err instanceof SyntaxError) return c.json({ error: "invalid request" }, 400);
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: "internal error" }, 500);
});

// JSON without an explicit charset is decoded as Latin-1 by strict clients (PowerShell,
// some HTTP libs), which mangles every non-ASCII character in task text. Say UTF-8 out loud.
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type");
  if (ct?.startsWith("application/json") && !ct.toLowerCase().includes("charset")) {
    c.res = new Response(c.res.body, c.res);
    c.res.headers.set("content-type", "application/json; charset=utf-8");
  }
});

app.use("/api/*", authMiddleware);

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/auth/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();
  // Compare HMAC digests rather than raw strings so a failed login can't time-probe the password.
  const [supplied, expected] = await Promise.all([
    hmac(c.env.AUTH_SECRET, typeof password === "string" ? password : ""),
    hmac(c.env.AUTH_SECRET, c.env.APP_PASSWORD),
  ]);
  if (supplied !== expected) return c.json({ error: "wrong password" }, 401);
  await setAuthCookie(c, c.env.AUTH_SECRET);
  return c.json({ ok: true });
});

app.get("/api/auth/check", (c) => c.json({ ok: true }));

app.post("/api/auth/logout", (c) => {
  clearAuthCookie(c);
  return c.json({ ok: true });
});

// Mounted before /api/tasks so /api/tasks/:id/attachments resolves here.
app.route("/api", attachmentRoutes);
app.route("/api/projects", projectRoutes);
app.route("/api/links", linkRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/inbox", inboxRoutes);
app.route("/api/gcal", gcalRoutes);
app.route("/mcp", mcpRoutes);
app.route("/habit", habitRoutes);

export default app;
