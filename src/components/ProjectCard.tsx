import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import type { ProjectSummary } from "../../shared/types";

export default function ProjectCard({ p, completed = false }: {
  p: ProjectSummary;
  completed?: boolean;
}) {
  const open = p.review_count + p.todo_count;
  // Nothing left to review or do, but work has happened: the project is resting rather than
  // finished. Dimmer than an active card, lighter than a completed one, and full opacity on hover.
  const dormant = !completed && open === 0 && p.done_count > 0;
  return (
    <Link
      to={`/project/${p.id}`}
      className={`card project-card${completed ? " completed" : ""}${dormant ? " dormant" : ""}`}
      style={{ "--pc": `var(--p-${p.accent})` } as CSSProperties}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(p.id));
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <h3>{p.icon ? `${p.icon} ` : ""}{p.name}<span className="id-chip">#{p.id}</span></h3>
      <div className="counts">
        {/* Same order as the board columns: review, then to do, then done. */}
        {p.review_count} to review · {p.todo_count} to do · {p.done_count} done
      </div>
      {p.tags?.length > 0 && (
        <div className="tag-row">
          {p.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
        </div>
      )}
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
