import type { Task } from "../../shared/types";
import { usePatchTask } from "../api";

export default function TaskRow({ task, subtasks, onOpen, draggable = false }: {
  task: Task;
  subtasks: Task[];
  onOpen: (t: Task) => void;
  draggable?: boolean;
}) {
  const patch = usePatchTask();
  const doneSubs = subtasks.filter((s) => s.status === "done").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !!task.due_date && task.status !== "done" && task.due_date < today;
  return (
    <div
      className={`task-row ${task.status === "done" ? "done" : ""}`}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(task.id))}
      onClick={() => onOpen(task)}
    >
      <input
        type="checkbox" className="check" checked={task.status === "done"}
        onClick={(e) => e.stopPropagation()}
        onChange={() =>
          patch.mutate({ id: task.id, patch: { status: task.status === "done" ? "todo" : "done" } })
        }
      />
      <div style={{ flex: 1 }}>
        <div className="task-title">{task.title}<span className="id-chip">#{task.id}</span></div>
        {(task.due_date || task.labels.length > 0 || subtasks.length > 0) && (
          <div className="task-meta">
            {task.due_date && (
              <span className={`due-chip ${overdue ? "overdue" : ""}`}>
                {task.due_date}{task.due_time ? ` ${task.due_time}` : ""}
              </span>
            )}
            {task.labels.map((l) => <span key={l} className="label-chip">{l}</span>)}
            {subtasks.length > 0 && <span>{doneSubs}/{subtasks.length}</span>}
          </div>
        )}
      </div>
      <span className={`prio prio-${task.priority}`} />
    </div>
  );
}
