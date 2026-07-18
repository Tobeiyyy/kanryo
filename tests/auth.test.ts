import { describe, expect, it } from "vitest";
import { hmac, signToken, verifyToken } from "../worker/auth";

const SECRET = "test-secret";

describe("auth tokens", () => {
  it("roundtrips a valid unexpired token", async () => {
    const token = await signToken(SECRET, Date.now() + 60_000);
    expect(await verifyToken(SECRET, token)).toBe(true);
  });

  it("rejects an expired token", async () => {
    const token = await signToken(SECRET, Date.now() - 1000);
    expect(await verifyToken(SECRET, token)).toBe(false);
  });

  it("rejects a tampered payload", async () => {
    const token = await signToken(SECRET, Date.now() + 60_000);
    const [, sig] = token.split(".");
    expect(await verifyToken(SECRET, `${Date.now() + 999_999}.${sig}`)).toBe(false);
  });

  it("rejects garbage", async () => {
    expect(await verifyToken(SECRET, "not-a-token")).toBe(false);
  });

  it("hmac is deterministic and secret-dependent", async () => {
    expect(await hmac(SECRET, "abc")).toBe(await hmac(SECRET, "abc"));
    expect(await hmac(SECRET, "abc")).not.toBe(await hmac("other", "abc"));
  });
});
