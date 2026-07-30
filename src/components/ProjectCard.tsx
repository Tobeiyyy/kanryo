import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import type { ProjectSummary } from "../../shared/types";

export default function ProjectCard({ p, completed = false }: {
  p: ProjectSummary;
  completed?: boolean;
}) {
  const open = p.consider_count + p.todo_count;
  return (
    <Link
      to={`/project/${p.id}`}
      className={`card project-card${completed ? " completed" : ""}`}
      style={{ "--pc": `var(--p-${p.accent})` } as CSSProperties}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(p.id));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <h3>{p.icon ? `${p.icon} ` : ""}{p.name}</h3>
      <div className="counts">
        {/* Same order as the board columns: review, then to do, then done. */}
        {p.consider_count} to review · {p.todo_count} to do · {p.done_count} done
      </div>
      {completed
        ? <div className="done-hint">completed {p.completed_at?.slice(0, 10)}</div>
        : p.next_due && open > 0 && <div className="due-hint">next due {p.next_due}</div>}
      {completed && (
        <svg className="done-tick" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="8,34 36,52 92,8" />
        </svg>
      )}
    </Link>
  );
}
