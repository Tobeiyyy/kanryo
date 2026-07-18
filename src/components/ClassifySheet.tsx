import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useDeleteTask, usePatchTask, useProjects } from "../api";
import type { Project, Task } from "../../shared/types";

export default function ClassifySheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const projects = useProjects();
  const patch = usePatchTask();
  const del = useDeleteTask();
  const qc = useQueryClient();
  const [newName, setNewName] = useState<string | null>(null);

  function attach(projectId: number) {
    patch.mutate({ id: task.id, patch: { project_id: projectId } }, { onSuccess: onClose });
  }

  async function createAndAttach(e: React.FormEvent) {
    e.preventDefault();
    if (!newName?.trim()) return;
    const p = await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: newName.trim() }),
    });
    void qc.invalidateQueries({ queryKey: ["projects"] });
    attach(p.id);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{task.title}</h2>
        {projects.data?.map((p) => (
          <button key={p.id} className="sheet-option" onClick={() => attach(p.id)}>
            <span>{p.icon ?? "▪"}</span> {p.name}
          </button>
        ))}
        {newName === null ? (
          <button className="sheet-option" onClick={() => setNewName(task.title)}>
            ＋ New project…
          </button>
        ) : (
          <form onSubmit={createAndAttach}>
            <input
              className="input" autoFocus value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </form>
        )}
        <button
          className="sheet-option" style={{ color: "var(--danger)" }}
          onClick={() => del.mutate(task.id, { onSuccess: onClose })}
        >
          Discard
        </button>
      </div>
    </div>
  );
}
