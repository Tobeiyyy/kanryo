import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useDeleteTask, usePatchTask, useProjects } from "../api";
import type { Project, Task } from "../../shared/types";

export default function ClassifySheet({ task, onClose }: { task: Task; onClose: () => void }) {
  const projects = useProjects();
  const patch = usePatchTask();
  const del = useDeleteTask();
  const qc = useQueryClient();
  const [newName, setNewName] = useState<string | null>(null);
  // Captured-in-five-seconds text is often half a thought; let it be fixed before it is filed.
  const [title, setTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    setTitle(task.title);
  }, [task.id, task.title]);

  useEffect(() => autoGrow(titleRef.current), [title]);

  function saveTitle() {
    const t = title.trim();
    if (!t || t === task.title) return;
    patch.mutate({ id: task.id, patch: { title: t } });
  }

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
        <textarea
          ref={titleRef}
          className="input title-input"
          rows={1}
          value={title}
          onChange={(e) => { setTitle(e.target.value); autoGrow(e.target); }}
          onBlur={saveTitle}
          aria-label="Idea text"
        />
        <p style={{ fontSize: 12, color: "var(--tx4)", margin: "4px 0 12px" }}>
          Edit the text above, then file it:
        </p>
        {projects.data?.map((p) => (
          <button key={p.id} className="sheet-option" onClick={() => attach(p.id)}>
            <span>{p.icon ?? "▪"}</span> {p.name}
          </button>
        ))}
        {newName === null ? (
          <button className="sheet-option" onClick={() => setNewName(title.trim() || task.title)}>
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
