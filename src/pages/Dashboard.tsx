import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useInbox, useProjects } from "../api";
import type { Project } from "../../shared/types";
import QuickAdd from "../components/QuickAdd";
import ProjectCard from "../components/ProjectCard";

export default function Dashboard() {
  const projects = useProjects();
  const inbox = useInbox();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
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

  return (
    <div>
      <QuickAdd />
      {(inbox.data?.length ?? 0) > 0 && (
        <Link to="/inbox" className="card teaser">
          <strong>{inbox.data!.length} in inbox</strong>
          <ul className="teaser-items">
            {inbox.data!.slice(0, 3).map((t) => <li key={t.id}>{t.title}</li>)}
          </ul>
        </Link>
      )}
      <div className="project-grid">
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
    </div>
  );
}
