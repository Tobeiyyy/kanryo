export type RpcMessage = { jsonrpc?: string; id?: number | string | null; method?: string; params?: any };

const PROTOCOL_VERSION = "2025-06-18";

export function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
export function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

const TASK_ITEM_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    status: { type: "string", enum: ["consider", "todo"], description: "consider = unvetted idea to triage later; todo = agreed action. Omit for the default (todo)." },
    priority: { type: "integer", minimum: 0, maximum: 3 },
    due_date: { type: "string", description: "YYYY-MM-DD — the day the user wants this on their calendar" },
    due_time: { type: "string", description: "HH:MM, only with due_date" },
    notes: { type: "string" },
  },
  required: ["title"],
};

const LINK_ITEM_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string" },
    url: { type: "string", description: "http(s) URL, obsidian:// URI, or a local path like C:\\..." },
    kind: { type: "string", enum: ["repo", "live", "storage", "claude", "other"] },
  },
  required: ["label", "url"],
};

export const TOOL_DEFS = [
  {
    name: "list_projects",
    description: "List the user's active Kanryo projects (id, name, description, open task counts). ALWAYS call this before creating anything — adding to an existing project beats creating a duplicate.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_project",
    description: "Create a new Kanryo project, optionally seeded with tasks and links. Offer this when a conversation has produced a concrete project-worthy idea — ask the user before calling. Seeded task statuses: consider for unvetted ideas, todo for agreed actions.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        icon: { type: "string", description: "a single emoji" },
        accent: { type: "string", enum: ["teal", "coral", "violet", "blue", "amber", "rose", "green", "slate"] },
        tasks: { type: "array", items: TASK_ITEM_SCHEMA },
        links: { type: "array", items: LINK_ITEM_SCHEMA },
      },
      required: ["name"],
    },
  },
  {
    name: "add_tasks",
    description: "Add tasks to an existing Kanryo project (get project_id from list_projects). Offer this when discussion surfaces new actionable work for something already tracked — ask the user before calling.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "integer" }, tasks: { type: "array", items: TASK_ITEM_SCHEMA } },
      required: ["project_id", "tasks"],
    },
  },
  {
    name: "add_links",
    description: "Attach links (repo, live page, storage/folder path, Claude chat URL, docs) to an existing Kanryo project — the project page is the user's one-stop hub for everything about that project.",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "integer" }, links: { type: "array", items: LINK_ITEM_SCHEMA } },
      required: ["project_id", "links"],
    },
  },
  {
    name: "add_inbox_item",
    description: "Drop a single stray-but-keepable idea into the Kanryo inbox for later triage — the lightweight outcome when something is worth keeping but not yet project-worthy. Ask the user before calling.",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
];

export async function handleRpc(
  msg: RpcMessage, callTool: (name: string, args: any) => Promise<unknown>,
): Promise<object | null> {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "kanryo", version: "1.0.0" },
      });
    case "notifications/initialized":
      return null;
    case "tools/list":
      return rpcResult(id, { tools: TOOL_DEFS });
    case "tools/call": {
      const name = msg.params?.name;
      if (typeof name !== "string" || !TOOL_DEFS.some((t) => t.name === name)) {
        return rpcError(id, -32602, `unknown tool: ${String(name)}`);
      }
      try {
        const result = await callTool(name, msg.params?.arguments ?? {});
        return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
      } catch (err) {
        return rpcResult(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `method not found: ${String(msg.method)}`);
  }
}
