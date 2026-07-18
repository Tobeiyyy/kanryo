import { describe, expect, it } from "vitest";
import { buildTaskPatch, defaultStatus, touchesGcal } from "../worker/taskLogic";

describe("defaultStatus (spec: status-default rule)", () => {
  it("project task defaults to todo", () => {
    expect(defaultStatus({ project_id: 3 })).toBe("todo");
  });
  it("inbox task defaults to consider", () => {
    expect(defaultStatus({})).toBe("consider");
    expect(defaultStatus({ project_id: null })).toBe("consider");
  });
  it("explicit status wins", () => {
    expect(defaultStatus({ project_id: 3, status: "consider" })).toBe("consider");
    expect(defaultStatus({ status: "done" })).toBe("done");
  });
  it("invalid explicit status falls back to the rule", () => {
    expect(defaultStatus({ project_id: 3, status: "bogus" })).toBe("todo");
  });
});

describe("buildTaskPatch (spec: presence-based PATCH)", () => {
  it("omitted keys never touch fields", () => {
    const { sets, values } = buildTaskPatch({ title: "x" });
    expect(sets).toEqual(["title = ?"]);
    expect(values).toEqual(["x"]);
  });
  it("present null keys do mutate (clearing due_date)", () => {
    const { sets, values } = buildTaskPatch({ due_date: null });
    expect(sets).toEqual(["due_date = ?"]);
    expect(values).toEqual([null]);
  });
  it("labels [] clears, absent labels preserves", () => {
    expect(buildTaskPatch({ labels: [] }).labels).toEqual([]);
    expect(buildTaskPatch({ title: "x" }).labels).toBeUndefined();
  });
  it("status done sets completed_at; leaving done clears it", () => {
    expect(buildTaskPatch({ status: "done" }).sets).toContain("completed_at = datetime('now')");
    expect(buildTaskPatch({ status: "todo" }).sets).toContain("completed_at = NULL");
  });
  it("promotion is a bare project_id patch", () => {
    const { sets, values } = buildTaskPatch({ project_id: 7 });
    expect(sets).toEqual(["project_id = ?"]);
    expect(values).toEqual([7]);
  });
  it("ignores unknown keys", () => {
    const { sets } = buildTaskPatch({ evil: 1 } as never);
    expect(sets).toEqual([]);
  });
});

describe("touchesGcal", () => {
  it("true for fields that alter desired event state", () => {
    for (const body of [{ title: "x" }, { due_date: "2026-08-01" }, { due_time: null }, { status: "done" }, { project_id: 2 }] as const) {
      expect(touchesGcal(body as never)).toBe(true);
    }
  });
  it("false for cosmetic fields", () => {
    expect(touchesGcal({ notes: "n" })).toBe(false);
    expect(touchesGcal({ priority: 2, position: 4 })).toBe(false);
    expect(touchesGcal({ labels: ["a"] })).toBe(false);
  });
});
