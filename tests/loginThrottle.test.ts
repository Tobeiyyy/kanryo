import { describe, expect, it } from "vitest";
import app from "../worker/index";

/** Mimics the Workers rate-limit binding: allows `max` calls per key. */
function fakeLimiter(max: number) {
  const seen = new Map<string, number>();
  return {
    async limit({ key }: { key: string }) {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= max };
    },
  };
}

const env = (limiter = fakeLimiter(5)) =>
  ({ APP_PASSWORD: "right-password", AUTH_SECRET: "s", LOGIN_LIMITER: limiter }) as never;

const login = (e: never, password: string, ip = "1.2.3.4") =>
  app.request(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({ password }),
    },
    e,
  );

describe("login throttling", () => {
  it("accepts the right password under the limit", async () => {
    expect((await login(env(), "right-password")).status).toBe(200);
  });

  it("rejects a wrong password with 401 under the limit", async () => {
    expect((await login(env(), "nope")).status).toBe(401);
  });

  it("returns 429 once the limit is used up, even for the right password", async () => {
    const e = env(fakeLimiter(5));
    for (let i = 0; i < 5; i++) expect((await login(e, "nope")).status).toBe(401);
    const blocked = await login(e, "right-password");
    expect(blocked.status).toBe(429);
  });

  it("counts per client IP", async () => {
    const e = env(fakeLimiter(1));
    expect((await login(e, "nope", "1.1.1.1")).status).toBe(401);
    expect((await login(e, "nope", "1.1.1.1")).status).toBe(429);
    expect((await login(e, "right-password", "2.2.2.2")).status).toBe(200);
  });
});
