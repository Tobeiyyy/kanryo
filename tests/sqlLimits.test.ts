import { describe, expect, it } from "vitest";
import { chunks, D1_MAX_PARAMS } from "../worker/sql";
import { attachLabels, attachTags } from "../worker/projects";

/** Fake D1 that fails exactly like the real one when a statement binds more than 100 values. */
function fakeDb(rows: Record<string, unknown>[]) {
  let statements = 0;
  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              statements++;
              if (args.length > D1_MAX_PARAMS) throw new Error("D1_ERROR: too many SQL variables");
              const wanted = new Set(args);
              return { results: rows.filter((r) => wanted.has(r.task_id ?? r.project_id)) };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, count: () => statements };
}

describe("chunks", () => {
  it("splits into slices of at most 100", () => {
    expect(chunks(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("keeps exactly 100 in one slice and returns nothing for nothing", () => {
    expect(chunks(Array.from({ length: 100 }, (_, i) => i)).length).toBe(1);
    expect(chunks([])).toEqual([]);
  });
});

describe("attachLabels with more than 100 tasks (the Tobe's Odyssey 500)", () => {
  const tasks = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
  const rows = [{ task_id: 1, label: "a" }, { task_id: 150, label: "b" }, { task_id: 250, label: "c" }];
  it("labels every task across batches instead of failing", async () => {
    const { db, count } = fakeDb(rows);
    const out = await attachLabels(db, tasks);
    expect(count()).toBe(3);
    expect(out.find((t) => t.id === 150)?.labels).toEqual(["b"]);
    expect(out.find((t) => t.id === 250)?.labels).toEqual(["c"]);
    expect(out.find((t) => t.id === 2)?.labels).toEqual([]);
  });
  it("does not query at all for an empty project", async () => {
    const { db, count } = fakeDb(rows);
    expect(await attachLabels(db, [])).toEqual([]);
    expect(count()).toBe(0);
  });
});

describe("attachTags with more than 100 projects", () => {
  it("tags every project across batches", async () => {
    const projects = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 }));
    const { db, count } = fakeDb([{ project_id: 101, tag: "x" }]);
    const out = await attachTags(db, projects);
    expect(count()).toBe(2);
    expect(out[100].tags).toEqual(["x"]);
  });
});
