import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GcalStatus, ProjectDetail, ProjectSummary, Task } from "../shared/types";
import type { TaskPatchBody } from "../worker/taskLogic";

export class UnauthorizedError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export function useProjects(view: "active" | "completed" = "active") {
  return useQuery({
    queryKey: ["projects", view],
    queryFn: () => api<ProjectSummary[]>(`/api/projects${view === "completed" ? "?completed=1" : ""}`),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["project", id],
    queryFn: () => api<ProjectDetail>(`/api/projects/${id}`),
    enabled: !!id,
  });
}

export function useInbox() {
  return useQuery({ queryKey: ["inbox"], queryFn: () => api<Task[]>("/api/inbox") });
}

export function useGcalStatus() {
  return useQuery({ queryKey: ["gcal"], queryFn: () => api<GcalStatus>("/api/gcal/status") });
}

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["project"] });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
  };
}

export type TaskCreateBody = TaskPatchBody & { title: string };

export function useCreateTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (body: TaskCreateBody) =>
      api<Task>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
}

export function usePatchTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: TaskPatchBody }) =>
      api<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}
