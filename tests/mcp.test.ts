import { describe, expect, it, vi } from "vitest";
import { handleRpc, TOOL_DEFS } from "../worker/mcp";

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
  it("tools/list returns the five capture tools", async () => {
    const res: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, call);
    expect(res.result.tools.map((t: any) => t.name).sort()).toEqual(
      ["add_inbox_item", "add_links", "add_tasks", "create_project", "list_projects"]);
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
  it("unknown method -> -32601", async () => {
    const res: any = await handleRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, call);
    expect(res.error.code).toBe(-32601);
  });
});
