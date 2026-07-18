import { Hono } from "hono";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD: string;
  AUTH_SECRET: string;
  GCAL_CLIENT_EMAIL: string;
  GCAL_PRIVATE_KEY: string;
};

export type App = Hono<{ Bindings: Env }>;

const app: App = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
