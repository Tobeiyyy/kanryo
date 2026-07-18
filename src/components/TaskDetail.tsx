import { useEffect, useState } from "react";
import { useCreateTask, useDeleteTask, usePatchTask, useProjects } from "../api";
import type { Task, TaskStatus } from "../../shared/types";
import type { TaskPatchBody } from "../../worker/taskLogic";

export default function TaskDetail({ task, subtasks, onClose }: {
  task: Task; subtasks: Task[]; onClose: () => void;
}) {
  const patch = usePatchTask();
  const del = useDeleteTask();
  const create = useCreateTask();
  const projects = useProjects();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [labelInput, setLabelInput] = useState("");
  const [subInput, setSubInput] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const save = (fields: TaskPatchBody) => patch.mutate({ id: task.id, patch: fields });

  function addLabel(e: React.FormEvent) {
    e.preventDefault();
    const l = labelInput.trim();
    if (!l || task.labels.includes(l)) return;
    save({ labels: [...task.labels, l] });
    setLabelInput("");
  }

  function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!subInput.trim()) return;
    create.mutate({ title: subInput.trim(), project_id: task.project_id, parent_id: task.id });
    setSubInput("");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <input
          className="input" style={{ fontWeight: 700, fontSize: 17 }}
          value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && save({ title: title.trim() })}
        />
        <div className="detail-grid">
          <div>
            <label>Status</label>
            <select className="input" value={task.status}
              onChange={(e) => save({ status: e.target.value as TaskStatus })}>
              <option value="consider">To consider</option>
              <option value="todo">To do</option>
              <option value="done">Done</option>
            </select>
          </div>
          <div>
            <label>Priority</label>
            <select className="input" value={task.priority}
              onChange={(e) => save({ priority: Number(e.target.value) })}>
              <option value={0}>None</option><option value={1}>Low</option>
              <option value={2}>Medium</option><option value={3}>High</option>
            </select>
          </div>
          <div>
            <label>Due date</label>
            <input type="date" className="input" value={task.due_date ?? ""}
              onChange={(e) => save({ due_date: e.target.value || null, ...(e.target.value ? {} : { due_time: null }) })} />
          </div>
          <div>
            <label>Due time</label>
            <input type="time" className="input" value={task.due_time ?? ""} disabled={!task.due_date}
              onChange={(e) => save({ due_time: e.target.value || null })} />
          </div>
          <div>
            <label>Project</label>
            <select className="input" value={task.project_id ?? ""}
              onChange={(e) => save({ project_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Inbox</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label>Labels</label>
            <form onSubmit={addLabel}>
              <input className="input" placeholder="add label ⏎" value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)} />
            </form>
          </div>
        </div>
        {task.labels.length > 0 && (
          <div className="filter-bar">
            {task.labels.map((l) => (
              <button key={l} className="chip on" title="Remove"
                onClick={() => save({ labels: task.labels.filter((x) => x !== l) })}>
                {l} ✕
              </button>
            ))}
          </div>
        )}
        <label style={{ fontSize: 12, color: "var(--tx3)" }}>Notes</label>
        <textarea className="input" rows={3} value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => (notes || null) !== task.notes && save({ notes: notes || null })} />

        <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>
          Subtasks {subtasks.length > 0 && `(${subtasks.filter((s) => s.status === "done").length}/${subtasks.length})`}
        </h3>
        {subtasks.map((s) => (
          <div key={s.id} className="subtask-row">
            <input type="checkbox" className="check" checked={s.status === "done"}
              onChange={() => patch.mutate({ id: s.id, patch: { status: s.status === "done" ? "todo" : "done" } })} />
            <span className="grow" style={s.status === "done" ? { textDecoration: "line-through", color: "var(--tx4)" } : {}}>
              {s.title}
            </span>
            <button className="icon-btn" onClick={() => del.mutate(s.id)}>✕</button>
          </div>
        ))}
        <form onSubmit={addSubtask}>
          <input className="input" placeholder="Add subtask ⏎" value={subInput}
            onChange={(e) => setSubInput(e.target.value)} />
        </form>

        <div className="settings-row" style={{ marginTop: 16, justifyContent: "space-between" }}>
          <button className="btn btn-danger" onClick={() => del.mutate(task.id, { onSuccess: onClose })}>
            Delete task
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
