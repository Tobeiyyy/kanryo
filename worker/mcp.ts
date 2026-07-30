import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./index";
import { hmac } from "./auth";
import { createTask, deleteTask, patchTask } from "./tasks";
import { ACCENTS, KINDS } from "./projects";

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
    status: { type: "string", enum: ["consider", "todo"], description: "consider = the app's 'To review' column: the user still wants to think it through (usually by talking it over with Claude) or hasn't committed to doing it. Always send the literal value 'consider' for it, even though the UI calls it review. todo = already discussed and decided in this conversation, just needs doing. DEFAULT IS consider — pass todo explicitly for work the user has actually decided on." },
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
    description: "List the user's active (not yet completed) Kanryo projects — id, name, description, per-status task counts. ALWAYS call this before creating anything — adding to an existing project beats creating a duplicate. Pass include_completed: true to also see finished projects. Use list_tasks to see the actual tasks in a project.",
    inputSchema: {
      type: "object",
      properties: { include_completed: { type: "boolean" } },
    },
  },
  {
    name: "set_project_completed",
    description: "Mark a whole Kanryo project finished, or reopen a finished one. Offer this when the user says a project is done or its last open work just got finished — ask first. Completing moves the project off the dashboard into the 'Completed' drawer; it does NOT touch the project's tasks, so check list_tasks first and mention any still-open tasks when you offer.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        completed: { type: "boolean", description: "true to complete, false to reopen" },
      },
      required: ["project_id", "completed"],
    },
  },
  {
    name: "list_tasks",
    description: "List the tasks in a Kanryo project, optionally filtered by status. Use it to answer questions like 'what's on my review list', to check whether something is already tracked before adding a duplicate, and to get the task_id needed by set_task_status. Kanryo's three states: consider (shown in the app as 'To review') = the user wants to think it through, typically in a conversation with Claude, or hasn't committed; todo = decided, waiting to be done; done = finished. The status values on the wire are always consider/todo/done.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "integer" },
        status: { type: "string", enum: ["consider", "todo", "done"] },
      },
      required: ["project_id"],
    },
  },
  {
    name: "set_task_status",
    description: "Move one or more Kanryo tasks between the three states. OFFER this (never do it silently) when: work just finished on something tracked (todo -> done); a 'to review' item (status value: consider) was talked through and the user decided to go ahead (consider -> todo) or is postponing it again; or the user says something is finished. Marking a task done also removes its Google Calendar event automatically. Get task_ids from list_tasks.",
    inputSchema: {
      type: "object",
      properties: {
        task_ids: { type: "array", items: { type: "integer" } },
        status: { type: "string", enum: ["consider", "todo", "done"] },
      },
      required: ["task_ids", "status"],
    },
  },
  {
    name: "create_project",
    description: "Create a new Kanryo project, optionally seeded with tasks and links. Offer this when a conversation has produced a concrete project-worthy idea — ask the user before calling. Seeded tasks default to consider (the 'To review' column); pass status 'todo' only for steps the user actually decided on in the conversation.",
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
    description: "Add tasks to an existing Kanryo project (get project_id from list_projects). Offer this when discussion surfaces new actionable work for something already tracked — ask the user before calling. Tasks default to consider (the 'To review' column); pass status 'todo' only for work the user has actually decided on.",
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
    name: "update_task",
    description: "Edit an existing Kanryo task's text or scheduling — title, notes, priority, due date/time. Presence-based: only the fields you pass change, everything else is left alone. Use this to fix a wording, sharpen a vague task, or add notes from a conversation, instead of creating a near-duplicate. For moving between review/todo/done use set_task_status. Get task_id from list_tasks. Offer before calling.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "integer" },
        title: { type: "string" },
        notes: { type: ["string", "null"] },
        priority: { type: "integer", minimum: 0, maximum: 3 },
        due_date: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear (which also removes the calendar event)" },
        due_time: { type: ["string", "null"], description: "HH:MM, or null to clear" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "delete_tasks",
    description: "PERMANENTLY delete Kanryo tasks (and their subtasks). Irreversible — always confirm with the user first, quoting the exact titles. Use only for genuine duplicates, mistakes, or things the user decided against; work that actually got finished belongs in done via set_task_status, not deleted. Get task_ids from list_tasks.",
    inputSchema: {
      type: "object",
      properties: { task_ids: { type: "array", items: { type: "integer" } } },
      required: ["task_ids"],
    },
  },
  {
    name: "add_inbox_item",
    description: "Drop a single stray-but-keepable idea into the Kanryo inbox for later triage — the lightweight outcome when something is worth keeping but not yet project-worthy. Ask the user before calling.",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
  {
    name: "list_inbox",
    description: "List the raw ideas sitting in the Kanryo inbox — items captured without a project, waiting to be filed. This is the entry point for inbox triage: read them, then use file_inbox_item to move each one onto the project it belongs to (calling create_project first when an idea deserves its own). Returns id, title, notes and capture date. An empty inbox is a normal result, not an error.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "file_inbox_item",
    description: "Move ONE inbox item out of the Kanryo inbox onto a project — the same thing the user does by hand on the Inbox page. Get task_id from list_inbox and project_id from list_projects. The item keeps its consider status, so it lands in the project's 'To review' column. Only works on unfiled inbox items: it refuses a task that already belongs to a project, so it can never re-parent established work.",
    inputSchema: {
      type: "object",
      properties: { task_id: { type: "integer" }, project_id: { type: "integer" } },
      required: ["task_id", "project_id"],
    },
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

// ---------- tool handlers ----------

type Ctx = Context<{ Bindings: Env }>;

class ToolError extends Error {}

const STATUS_VALUES = ["consider", "todo", "done"];

async function requireProject(c: Ctx, id: unknown): Promise<any> {
  const project = typeof id === "number"
    ? await c.env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first()
    : null;
  if (!project) throw new ToolError(`project ${String(id)} not found — call list_projects first`);
  return project;
}

async function addTasksTo(c: Ctx, projectId: number, tasks: unknown): Promise<any[]> {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const out: any[] = [];
  for (const t of tasks) {
    const r = await createTask(c, {
      title: t?.title, project_id: projectId, status: t?.status,
      priority: t?.priority, due_date: t?.due_date, due_time: t?.due_time, notes: t?.notes,
    });
    if (r.error) throw new ToolError(`task ${JSON.stringify(t?.title ?? null)}: ${r.error}`);
    out.push(r.task);
  }
  return out;
}

async function addLinksTo(c: Ctx, projectId: number, links: unknown): Promise<any[]> {
  if (!Array.isArray(links) || links.length === 0) return [];
  const out: any[] = [];
  for (const l of links) {
    const label = typeof l?.label === "string" ? l.label.trim() : "";
    const url = typeof l?.url === "string" ? l.url.trim() : "";
    if (!label || !url) throw new ToolError("each link needs label and url");
    const kind = KINDS.includes(l?.kind) ? l.kind : "other";
    out.push(await c.env.DB.prepare(
      `INSERT INTO project_links (project_id, label, url, kind, position)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM project_links WHERE project_id = ?))
       RETURNING *`,
    ).bind(projectId, label, url, kind, projectId).first());
  }
  return out;
}

async function callTool(c: Ctx, name: string, args: any): Promise<unknown> {
  switch (name) {
    case "list_projects": {
      // Completion, not the vestigial status column, decides what counts as active.
      const includeCompleted = args.include_completed === true;
      const { results } = await c.env.DB.prepare(
        `SELECT p.id, p.name, p.description, p.icon, p.accent, p.completed_at,
           COUNT(CASE WHEN t.status = 'consider' AND t.parent_id IS NULL THEN 1 END) AS consider_count,
           COUNT(CASE WHEN t.status = 'todo' AND t.parent_id IS NULL THEN 1 END) AS todo_count,
           COUNT(CASE WHEN t.status = 'done' AND t.parent_id IS NULL THEN 1 END) AS done_count
         FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
         ${includeCompleted ? "" : "WHERE p.completed_at IS NULL"}
         GROUP BY p.id ORDER BY p.name`,
      ).all();
      return { projects: results };
    }
    case "set_project_completed": {
      const project = await requireProject(c, args.project_id);
      if (typeof args.completed !== "boolean") throw new ToolError("completed must be true or false");
      const row = await c.env.DB.prepare(
        `UPDATE projects SET completed_at = ${args.completed ? "datetime('now')" : "NULL"}
         WHERE id = ? RETURNING id, name, completed_at`,
      ).bind(project.id).first<any>();
      const open = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status != 'done' AND parent_id IS NULL",
      ).bind(project.id).first<{ n: number }>();
      return { project: row, open_tasks: open?.n ?? 0 };
    }
    case "create_project": {
      const projName = typeof args.name === "string" ? args.name.trim() : "";
      if (!projName) throw new ToolError("name is required");
      const accent = ACCENTS.includes(args.accent) ? args.accent : "teal";
      const project = await c.env.DB.prepare(
        "INSERT INTO projects (name, description, accent, icon) VALUES (?, ?, ?, ?) RETURNING *",
      ).bind(projName, args.description ?? null, accent, args.icon ?? null).first<any>();
      const tasks = await addTasksTo(c, project.id, args.tasks);
      const links = await addLinksTo(c, project.id, args.links);
      return {
        project, tasks_created: tasks.length, links_created: links.length,
        url: `${new URL(c.req.url).origin}/project/${project.id}`,
      };
    }
    case "add_tasks": {
      const project = await requireProject(c, args.project_id);
      const tasks = await addTasksTo(c, project.id, args.tasks);
      if (tasks.length === 0) throw new ToolError("tasks array is required and must be non-empty");
      return { project: project.name, tasks_created: tasks.length, tasks };
    }
    case "add_links": {
      const project = await requireProject(c, args.project_id);
      const links = await addLinksTo(c, project.id, args.links);
      if (links.length === 0) throw new ToolError("links array is required and must be non-empty");
      return { project: project.name, links_created: links.length, links };
    }
    case "list_tasks": {
      const project = await requireProject(c, args.project_id);
      const status = typeof args.status === "string" ? args.status : null;
      if (status && !STATUS_VALUES.includes(status)) throw new ToolError("status must be consider, todo or done");
      const { results } = status
        ? await c.env.DB.prepare(
            `SELECT id, title, status, priority, due_date, due_time, parent_id, notes
             FROM tasks WHERE project_id = ? AND status = ? ORDER BY position, id`,
          ).bind(project.id, status).all()
        : await c.env.DB.prepare(
            `SELECT id, title, status, priority, due_date, due_time, parent_id, notes
             FROM tasks WHERE project_id = ? ORDER BY status, position, id`,
          ).bind(project.id).all();
      return { project: project.name, tasks: results };
    }
    case "set_task_status": {
      const ids = Array.isArray(args.task_ids) ? args.task_ids.filter((x: unknown) => typeof x === "number") : [];
      if (ids.length === 0) throw new ToolError("task_ids must contain at least one task id — get them from list_tasks");
      if (!STATUS_VALUES.includes(args.status)) throw new ToolError("status must be consider, todo or done");
      const updated: any[] = [];
      for (const id of ids) {
        const r = await patchTask(c, id, { status: args.status });
        if (r.error) throw new ToolError(`task ${id}: ${r.error}`);
        updated.push({ id: r.task.id, title: r.task.title, status: r.task.status });
      }
      return { updated_count: updated.length, tasks: updated };
    }
    case "update_task": {
      if (typeof args.task_id !== "number") throw new ToolError("task_id is required — get it from list_tasks");
      const patch: Record<string, unknown> = {};
      for (const f of ["title", "notes", "priority", "due_date", "due_time"]) {
        if (f in args) patch[f] = args[f];
      }
      if (Object.keys(patch).length === 0) throw new ToolError("pass at least one field to change");
      const r = await patchTask(c, args.task_id, patch);
      if (r.error) throw new ToolError(`task ${args.task_id}: ${r.error}`);
      return { task: r.task };
    }
    case "delete_tasks": {
      const ids = Array.isArray(args.task_ids) ? args.task_ids.filter((x: unknown) => typeof x === "number") : [];
      if (ids.length === 0) throw new ToolError("task_ids must contain at least one task id — get them from list_tasks");
      const deleted: any[] = [];
      for (const id of ids) {
        const r = await deleteTask(c, id);
        if (r.error) throw new ToolError(`task ${id}: ${r.error}`);
        deleted.push(r.task);
      }
      return { deleted_count: deleted.length, tasks: deleted };
    }
    case "add_inbox_item": {
      const r = await createTask(c, { title: args.title });
      if (r.error) throw new ToolError(r.error);
      return { task: r.task, note: "added to inbox for later triage" };
    }
    case "list_inbox": {
      // Same query as the app's Inbox page, so the tool shows exactly what the user sees.
      const { results } = await c.env.DB.prepare(
        "SELECT id, title, notes, created_at FROM tasks WHERE project_id IS NULL ORDER BY created_at DESC, id DESC",
      ).all();
      return { items: results };
    }
    case "file_inbox_item": {
      const project = await requireProject(c, args.project_id);
      if (typeof args.task_id !== "number") throw new ToolError("task_id is required — get it from list_inbox");
      const row = await c.env.DB.prepare("SELECT id, project_id FROM tasks WHERE id = ?")
        .bind(args.task_id).first<{ id: number; project_id: number | null }>();
      if (!row) throw new ToolError(`task ${args.task_id} not found`);
      // The guard that keeps this from becoming a general re-parent tool.
      if (row.project_id !== null) {
        throw new ToolError(
          `task ${args.task_id} is already filed under project ${row.project_id} — file_inbox_item only moves items out of the inbox`,
        );
      }
      const r = await patchTask(c, args.task_id, { project_id: project.id });
      if (r.error) throw new ToolError(`task ${args.task_id}: ${r.error}`);
      return { task: r.task, project: project.name };
    }
    default:
      throw new ToolError(`unhandled tool: ${name}`);
  }
}

export const mcpRoutes = new Hono<{ Bindings: Env }>();

mcpRoutes.post("/:token", async (c) => {
  const expected = c.env.KANRYO_TOKEN ?? "";
  const [a, b] = await Promise.all([
    hmac(c.env.AUTH_SECRET, c.req.param("token")),
    hmac(c.env.AUTH_SECRET, expected),
  ]);
  if (!expected || a !== b) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<RpcMessage>();
  const res = await handleRpc(body, (name, args) => callTool(c, name, args));
  if (res === null) return c.body(null, 202);
  return c.json(res as any);
});

// Streamable-HTTP clients may probe GET for an SSE stream; we don't offer one.
mcpRoutes.get("/:token", (c) => c.body(null, 405));
