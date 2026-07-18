export type TaskStatus = "consider" | "todo" | "done";
export type LinkKind = "repo" | "live" | "storage" | "claude" | "other";
export type AccentKey =
  | "teal" | "coral" | "violet" | "blue" | "amber" | "rose" | "green" | "slate";

export interface Project {
  id: number;
  name: string;
  description: string | null;
  accent: AccentKey;
  icon: string | null;
  status: "active" | "archived";
  created_at: string;
}

export interface ProjectSummary extends Project {
  consider_count: number;
  todo_count: number;
  done_count: number;
  next_due: string | null;
  last_activity: string;
}

export interface ProjectLink {
  id: number;
  project_id: number;
  label: string;
  url: string;
  kind: LinkKind;
  position: number;
}

export interface Task {
  id: number;
  project_id: number | null;
  parent_id: number | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: number;
  due_date: string | null;
  due_time: string | null;
  position: number;
  gcal_event_id: string | null;
  gcal_dirty: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  labels: string[];
}

export interface ProjectDetail {
  project: Project;
  links: ProjectLink[];
  tasks: Task[];
}

export interface GcalStatus {
  configured: boolean;
  client_email: string | null;
  calendar_id: string | null;
  timezone: string;
  error: { class: "auth" | "transient"; message: string; at: string } | null;
  dirty_count: number;
  orphan_count: number;
}
