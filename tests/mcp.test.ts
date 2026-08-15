import { describe, expect, it, vi } from "vitest";
import { handleRpc, mcpRoutes, TOOL_DEFS } from "../worker/mcp";
import { addDays, logicalDate } from "../worker/habitLogic";

const call = vi.fn(async () => ({ ok: true }));

describe("handleRpc", () => {
  it("initialize returns protocol echo, tools capability, serverInfo", async () => {
    const res: any = await handleRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, call);
    expect(res.result.protocolVersion).toBe("2025-03-26");
    expect(res.result.capabilities).toEqual({ tools: {} });
    expect(res.result.serverInfo.name).toBe("kanryo");
  });
  it("initialize without client version uses server default", async () => {
    const res: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, call);
    expect(typeof res.result.protocolVersion).toBe("string");
  });
  it("notifications/initialized returns null (202)", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, call)).toBeNull();
  });
  it("tools/list returns the capture and lifecycle tools", async () => {
    const res: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, call);
    expect(res.result.tools.map((t: any) => t.name).sort()).toEqual(
      ["add_inbox_item", "add_links", "add_tasks", "create_project", "delete_tasks",
       "file_inbox_item", "get_habit_log", "get_task", "list_inbox", "list_projects",
       "list_task_attachments", "list_tasks", "log_habits", "set_project_completed",
       "set_project_tags", "set_task_status", "update_task", "view_attachment"]);
    for (const t of res.result.tools) {
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema.type).toBe("object");
    }
  });
  it("tools/call routes to the handler and wraps result as text content", async () => {
    const res: any = await handleRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_projects", arguments: {} } }, call);
    expect(call).toHaveBeenCalledWith("list_projects", {});
    expect(JSON.parse(res.result.content[0].text)).toEqual({ ok: true });
    expect(res.result.isError).toBeUndefined();
  });
  it("tools/call with unknown tool -> -32602", async () => {
    const res: any = await handleRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, call);
    expect(res.error.code).toBe(-32602);
  });
  it("handler throw -> isError content, not a protocol error", async () => {
    const boom = vi.fn(async () => { throw new Error("project 9 not found"); });
    const res: any = await handleRpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "add_tasks", arguments: {} } }, boom);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain("project 9 not found");
  });
  it("set_task_status accepts all three states in its schema", async () => {
    const tool = TOOL_DEFS.find((t) => t.name === "set_task_status")!;
    expect((tool.inputSchema.properties as any).status.enum).toEqual(["consider", "todo", "done"]);
    expect(tool.inputSchema.required).toEqual(["task_ids", "status"]);
  });
  it("update_task takes only a task_id as required, edits are presence-based", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "update_task")!;
    expect(tool.inputSchema.required).toEqual(["task_id"]);
    expect(Object.keys(tool.inputSchema.properties as any).sort()).toEqual(
      ["due_date", "due_time", "notes", "priority", "task_id", "title"]);
  });
  it("set_project_completed toggles both ways and needs both args", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "set_project_completed")!;
    expect(tool.inputSchema.required).toEqual(["project_id", "completed"]);
    expect((tool.inputSchema.properties as any).completed.type).toBe("boolean");
  });
  it("list_inbox takes no arguments", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "list_inbox")!;
    expect(Object.keys(tool.inputSchema.properties as any)).toEqual([]);
    expect((tool.inputSchema as any).required).toBeUndefined();
  });
  it("file_inbox_item needs both ids and says it only moves inbox items", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "file_inbox_item")!;
    expect(tool.inputSchema.required).toEqual(["task_id", "project_id"]);
    expect(tool.description).toMatch(/refuses a task that already belongs to a project/i);
  });
  it("tag tools tell Claude that shared tags mean related projects", () => {
    const list = TOOL_DEFS.find((t) => t.name === "list_projects")!;
    expect(list.description).toMatch(/share a tag are related/i);
    const setTags = TOOL_DEFS.find((t) => t.name === "set_project_tags")!;
    expect(setTags.inputSchema.required).toEqual(["project_id", "tags"]);
  });
  it("delete_tasks warns that it is permanent", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "delete_tasks")!;
    expect(tool.description).toMatch(/PERMANENTLY|Irreversible/i);
  });
  it("unknown method -> -32601", async () => {
    const res: any = await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, call);
    expect(res.error.code).toBe(-32601);
  });
  it("log_habits requires dated entries and documents the '-' translation rule", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "log_habits")!;
    expect(tool.inputSchema.required).toEqual(["entries"]);
    const entry = (tool.inputSchema.properties as any).entries.items;
    expect(entry.required).toEqual(["date", "chunk", "picked"]);
    expect(entry.properties.chunk.enum).toEqual(["morning", "workout", "read"]);
    expect(tool.description).toMatch(/'-' = OMIT/i);
    expect(tool.description).toMatch(/all-or-nothing/i);
  });
  it("get_habit_log takes only optional from/to and explains NULL vs 0", () => {
    const tool = TOOL_DEFS.find((t) => t.name === "get_habit_log")!;
    expect((tool.inputSchema as any).required).toBeUndefined();
    expect(Object.keys(tool.inputSchema.properties as any).sort()).toEqual(["from", "to"]);
    expect(tool.description).toMatch(/null.*not reported/i);
  });
});

function fakeDb() {
  const stmt: any = {
    bind: vi.fn(() => stmt),
    first: vi.fn(async () => null),
    all: vi.fn(async () => ({ results: [] })),
  };
  const db: any = { prepare: vi.fn(() => stmt), batch: vi.fn(async () => []) };
  return db;
}

const ENV = (db: any) => ({ DB: db, KANRYO_TOKEN: "tok", AUTH_SECRET: "s" }) as any;

const callHabits = (args: unknown, env: any) =>
  mcpRoutes.request("/tok", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "log_habits", arguments: args },
    }),
  }, env);

describe("log_habits handler", () => {
  const today = logicalDate();

  it("mixed batch: the invalid entry rejects the whole batch by index, nothing written", async () => {
    const db = fakeDb();
    const res = await callHabits({ entries: [
      { date: today, chunk: "read", picked: ["read"] },
      { date: today, chunk: "evening", picked: [] },
    ] }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/nothing written/);
    expect(body.result.content[0].text).toMatch(/entry 1: unknown chunk/);
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("valid batch: one db.batch call, returns written count and sorted unique dates", async () => {
    const db = fakeDb();
    const yesterday = addDays(today, -1);
    const res = await callHabits({ entries: [
      { date: today, chunk: "read", picked: [] },
      { date: yesterday, chunk: "morning", picked: ["up", "med"] },
      { date: yesterday, chunk: "workout", picked: ["workout"] },
    ] }, ENV(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(body.result.content[0].text)).toEqual({ written: 3, dates: [yesterday, today] });
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(db.batch.mock.calls[0][0]).toHaveLength(3);
  });

  it("null entry -> per-entry error, not a TypeError crash", async () => {
    const db = fakeDb();
    const res = await callHabits({ entries: [null] }, ENV(db));
    const body = (await res.json()) as any;
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/entry 0/);
    expect(body.result.content[0].text).not.toMatch(/Cannot read properties/);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
