import { describe, expect, it } from "vitest";
import { addMinutes, classifyGcalError, desiredEvent, nextDay, syncAction } from "../worker/gcal";

const base = {
  id: 1, title: "Ship it", status: "todo", due_date: "2026-08-01",
  due_time: null as string | null, gcal_event_id: null as string | null, project_name: "Kanryo",
};

describe("desiredEvent (spec invariant: event iff due_date AND status != done)", () => {
  it("no due date -> null", () => {
    expect(desiredEvent({ ...base, due_date: null }, "Europe/Berlin")).toBeNull();
  });
  it("done -> null even with due date", () => {
    expect(desiredEvent({ ...base, status: "done" }, "Europe/Berlin")).toBeNull();
  });
  it("date only -> all-day event ending next day", () => {
    const ev = desiredEvent(base, "Europe/Berlin")!;
    expect(ev.summary).toBe("Ship it");
    expect(ev.start).toEqual({ date: "2026-08-01" });
    expect(ev.end).toEqual({ date: "2026-08-02" });
    expect(ev.description).toContain("Kanryo");
  });
  it("date+time -> timed 30-minute event in given tz", () => {
    const ev = desiredEvent({ ...base, due_time: "14:45" }, "Europe/Berlin")!;
    expect(ev.start).toEqual({ dateTime: "2026-08-01T14:45:00", timeZone: "Europe/Berlin" });
    expect(ev.end).toEqual({ dateTime: "2026-08-01T15:15:00", timeZone: "Europe/Berlin" });
  });
  it("inbox task shows Inbox as project name", () => {
    const ev = desiredEvent({ ...base, project_name: null }, "Europe/Berlin")!;
    expect(ev.description).toContain("Inbox");
  });
});

describe("date helpers", () => {
  it("addMinutes rolls over midnight", () => {
    expect(addMinutes("2026-08-01", "23:45", 30)).toBe("2026-08-02T00:15:00");
  });
  it("nextDay rolls over month and year", () => {
    expect(nextDay("2026-07-31")).toBe("2026-08-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("syncAction convergence matrix", () => {
  const desired = { summary: "x", description: "", start: { date: "2026-08-01" }, end: { date: "2026-08-02" } };
  it("covers all four cells", () => {
    expect(syncAction(false, desired)).toBe("create");
    expect(syncAction(true, desired)).toBe("patch");
    expect(syncAction(true, null)).toBe("delete");
    expect(syncAction(false, null)).toBe("none");
  });
});

describe("classifyGcalError (spec error taxonomy)", () => {
  it("401/403 are auth-class", () => {
    expect(classifyGcalError(401)).toBe("auth");
    expect(classifyGcalError(403)).toBe("auth");
  });
  it("everything else is transient", () => {
    for (const s of [400, 404, 429, 500, 503, 0]) expect(classifyGcalError(s)).toBe("transient");
  });
});
