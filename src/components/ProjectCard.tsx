import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import type { ProjectSummary } from "../../shared/types";

export default function ProjectCard({ p }: { p: ProjectSummary }) {
  const open = p.consider_count + p.todo_count;
  return (
    <Link
      to={`/project/${p.id}`}
      className="card project-card"
      style={{ "--pc": `var(--p-${p.accent})` } as CSSProperties}
    >
      <h3>{p.icon ? `${p.icon} ` : ""}{p.name}</h3>
      <div className="counts">
        {p.todo_count} to do · {p.consider_count} to consider · {p.done_count} done
      </div>
      {p.next_due && open > 0 && <div className="due-hint">next due {p.next_due}</div>}
    </Link>
  );
}
