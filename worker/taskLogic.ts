import type { TaskStatus } from "../shared/types";

export const STATUSES: readonly TaskStatus[] = ["consider", "todo", "done"];

export type TaskPatchBody = {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: number;
  due_date?: string | null;
  due_time?: string | null;
  project_id?: number | null;
  parent_id?: number | null;
  position?: number;
  labels?: string[];
};

/**
 * Everything lands in `consider` unless it explicitly says otherwise: most captured things
 * still need a conversation before they are real work. Only a caller that knows the task was
 * already decided passes `todo`.
 */
export function defaultStatus(body: { project_id?: number | null; status?: string }): TaskStatus {
  if (body.status && (STATUSES as readonly string[]).includes(body.status)) {
    return body.status as TaskStatus;
  }
  return "consider";
}

const PATCHABLE = [
  "title", "notes", "status", "priority", "due_date", "due_time",
  "project_id", "parent_id", "position",
] as const;

/** Presence-based partial update: only keys present in the body mutate (spec PATCH semantics). */
export function buildTaskPatch(body: TaskPatchBody): { sets: string[]; values: unknown[]; labels?: string[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const f of PATCHABLE) {
    if (f in body) {
      sets.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if ("status" in body) {
    sets.push(body.status === "done" ? "completed_at = datetime('now')" : "completed_at = NULL");
  }
  return { sets, values, labels: "labels" in body ? body.labels : undefined };
}

const GCAL_FIELDS = ["title", "due_date", "due_time", "status", "project_id"] as const;

/** Whether a patch can change the task's desired calendar event (title/description/date/existence). */
export function touchesGcal(body: TaskPatchBody): boolean {
  return GCAL_FIELDS.some((f) => f in body);
}
