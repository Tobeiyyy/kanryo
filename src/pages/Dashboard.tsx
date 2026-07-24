import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useInbox, useProjects } from "../api";
import type { Project } from "../../shared/types";
import QuickAdd from "../components/QuickAdd";
import ProjectCard from "../components/ProjectCard";

type Zone = "active" | "completed";

export default function Dashboard() {
  const projects = useProjects();
  const completed = useProjects("completed");
  const inbox = useInbox();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [hoverZone, setHoverZone] = useState<Zone | null>(null);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const p = await api<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    void qc.invalidateQueries({ queryKey: ["projects"] });
    navigate(`/project/${p.id}`);
  }

  function move(id: number, toCompleted: boolean) {
    void api(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: toCompleted }),
    }).then(() => qc.invalidateQueries({ queryKey: ["projects"] }));
  }

  /** Drag a project card between the active grid and the completed drawer, either direction. */
  const zone = (z: Zone) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverZone(z); },
    onDragLeave: () => setHoverZone((cur) => (cur === z ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setHoverZone(null);
      const id = Number(e.dataTransfer.getData("text/plain"));
      if (id) move(id, z === "completed");
    },
  });

  const doneCount = completed.data?.length ?? 0;

  return (
    // Drag events bubble from the cards, so the completed drawer can reveal itself as a drop
    // target the moment a drag starts — otherwise the very first completion has nowhere to land.
    <div onDragStart={() => setDragging(true)} onDragEnd={() => setDragging(false)}>
      <QuickAdd />
      {(inbox.data?.length ?? 0) > 0 && (
        <Link to="/inbox" className="card teaser">
          <strong>{inbox.data!.length} in inbox</strong>
          <ul className="teaser-items">
            {inbox.data!.slice(0, 3).map((t) => <li key={t.id}>{t.title}</li>)}
          </ul>
        </Link>
      )}

      <div
        className={`project-grid${hoverZone === "active" ? " drop-target" : ""}`}
        {...zone("active")}
      >
        {projects.data?.map((p) => <ProjectCard key={p.id} p={p} />)}
        {creating ? (
          <form className="card project-card" onSubmit={createProject}>
            <input
              className="input" autoFocus placeholder="Project name"
              value={name} onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (!name.trim()) setCreating(false); }}
            />
          </form>
        ) : (
          <button className="card project-card" style={{ cursor: "pointer", textAlign: "left" }} onClick={() => setCreating(true)}>
            <h3>+ New project</h3>
          </button>
        )}
      </div>

      {(doneCount > 0 || dragging) && (
        <section
          className={`completed-section${hoverZone === "completed" ? " drop-target" : ""}`}
          {...zone("completed")}
        >
          <button
            className={`completed-toggle${showCompleted ? " open" : ""}`}
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <span className="caret">▸</span> Completed ({doneCount})
          </button>
          {showCompleted && (
            <div className="project-grid">
              {completed.data?.map((p) => <ProjectCard key={p.id} p={p} completed />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
