import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, useCreateTask, usePatchTask, useProject, useProjects } from "../api";
import type { ProjectLink, Task, TaskStatus } from "../../shared/types";
import TaskRow from "../components/TaskRow";
import TaskDetail from "../components/TaskDetail";

const STATUSES: TaskStatus[] = ["consider", "todo", "done"];
const STATUS_LABELS: Record<TaskStatus, string> = {
  // The stored value stays `consider` (changing it means rebuilding the tasks table); the
  // column is called "To review" everywhere the user sees it.
  consider: "To review", todo: "To do", done: "Done",
};
const ACCENTS = ["teal", "coral", "violet", "blue", "amber", "rose", "green", "slate"];
const KINDS = ["repo", "live", "storage", "claude", "other"];
const KIND_ICONS: Record<string, string> = {
  repo: "⌥", live: "🌐", storage: "🗄", claude: "✳", other: "🔗",
};

function useMediaQuery(qs: string): boolean {
  const [m, setM] = useState(() => matchMedia(qs).matches);
  useEffect(() => {
    const mq = matchMedia(qs);
    const fn = () => setM(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, [qs]);
  return m;
}

export default function Project() {
  const { id } = useParams();
  const q = useProject(id);
  const patch = usePatchTask();
  const create = useCreateTask();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery("(min-width: 900px)");
  const [tab, setTab] = useState<TaskStatus>("todo");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [prioFilter, setPrioFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newLink, setNewLink] = useState({ label: "", url: "", kind: "other" });
  const [newTag, setNewTag] = useState("");
  const allProjects = useProjects();

  if (!q.data) return null;
  const { project, links, tasks } = q.data;
  const topLevel = tasks.filter((t) => t.parent_id === null);
  const subsOf = (t: Task) => tasks.filter((s) => s.parent_id === t.id);
  const allLabels = [...new Set(topLevel.flatMap((t) => t.labels))].sort();
  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const visible = (status: TaskStatus) =>
    topLevel
      .filter((t) => t.status === status)
      .filter((t) => labelFilter.length === 0 || labelFilter.every((l) => t.labels.includes(l)))
      .filter((t) => prioFilter === null || t.priority === prioFilter)
      .sort((a, b) => a.position - b.position || a.id - b.id);

  function patchProject(fields: Record<string, unknown>) {
    void api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(fields) })
      .then(() => {
        void qc.invalidateQueries({ queryKey: ["project", id] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
      });
  }

  function dropOnColumn(taskId: number, status: TaskStatus) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === status) return;
    const maxPos = Math.max(-1, ...visible(status).map((x) => x.position));
    patch.mutate({ id: taskId, patch: { status, position: maxPos + 1 } });
  }

  function dropOnRow(dragId: number, target: Task) {
    const t = tasks.find((x) => x.id === dragId);
    if (!t) return;
    if (t.status !== target.status) { dropOnColumn(dragId, target.status); return; }
    const ids = visible(target.status).map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(target.id), 0, dragId);
    // optimistic: reflect new order immediately
    qc.setQueryData(["project", id], (old: typeof q.data) => old && {
      ...old,
      tasks: old.tasks.map((x) => ids.includes(x.id) ? { ...x, position: ids.indexOf(x.id) } : x),
    });
    void api("/api/tasks/positions", {
      method: "POST",
      body: JSON.stringify({ project_id: project.id, status: target.status, ids }),
    }).then(() => qc.invalidateQueries({ queryKey: ["project", id] }));
  }

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    // Desktop shows all three columns, so a new task starts in "to review" (the default);
    // on mobile it lands in whichever column you're looking at, or it would vanish from view.
    create.mutate({ title: newTask.trim(), project_id: project.id, status: isDesktop ? "consider" : tab });
    setNewTask("");
  }

  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const t = newTag.trim();
    if (!t || project.tags?.includes(t)) { setNewTag(""); return; }
    patchProject({ tags: [...(project.tags ?? []), t] });
    setNewTag("");
  }

  function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!newLink.label.trim() || !newLink.url.trim()) return;
    void api(`/api/projects/${project.id}/links`, { method: "POST", body: JSON.stringify(newLink) })
      .then(() => {
        setNewLink({ label: "", url: "", kind: "other" });
        void qc.invalidateQueries({ queryKey: ["project", id] });
      });
  }

  const completeButton = (
    <button
      className="btn complete-btn"
      onClick={() => patchProject({ completed: !project.completed_at })}
    >
      {project.completed_at ? "Reopen project" : "✓ Complete project"}
    </button>
  );

  function renderColumn(status: TaskStatus) {
    return (
      <Column
        key={status} status={status} label={STATUS_LABELS[status]}
        tasks={visible(status)} onDrop={dropOnColumn}
        footer={status === "done" ? completeButton : null}
        render={(t) => (
          <div key={t.id}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault(); e.stopPropagation();
              dropOnRow(Number(e.dataTransfer.getData("text/plain")), t);
            }}>
            <TaskRow task={t} subtasks={subsOf(t)} onOpen={(x) => setSelectedId(x.id)} draggable={isDesktop} />
          </div>
        )}
      />
    );
  }

  return (
    <div>
      <header className="proj-header">
        <h1>
          {project.icon ? `${project.icon} ` : ""}{project.name}
          <button className="icon-btn" title="Edit project" onClick={() => setEditing(!editing)}>✎</button>
        </h1>
        {project.description && <p className="proj-desc">{project.description}</p>}
        {(project.tags?.length ?? 0) > 0 && (
          <div className="tag-row" style={{ marginBottom: 8 }}>
            {project.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
          </div>
        )}
        <div className="link-chips">
          {(links as ProjectLink[]).map((l) => <LinkChip key={l.id} link={l} />)}
        </div>
      </header>

      {editing && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div className="settings-row">
            <input className="input" style={{ maxWidth: 220 }} defaultValue={project.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== project.name && patchProject({ name: e.target.value.trim() })} />
            <input className="input" style={{ maxWidth: 70 }} placeholder="icon" defaultValue={project.icon ?? ""}
              onBlur={(e) => (e.target.value || null) !== project.icon && patchProject({ icon: e.target.value || null })} />
            {ACCENTS.map((a) => (
              <span key={a} className={`accent-dot ${project.accent === a ? "on" : ""}`}
                style={{ background: `var(--p-${a})` }} onClick={() => patchProject({ accent: a })} />
            ))}
          </div>
          <div className="settings-row">
            {(project.tags ?? []).map((t) => (
              <button key={t} className="chip on" title="Remove tag"
                onClick={() => patchProject({ tags: (project.tags ?? []).filter((x) => x !== t) })}>
                {t} ✕
              </button>
            ))}
            <form onSubmit={addTag} style={{ display: "inline" }}>
              <input className="input" style={{ maxWidth: 150 }} placeholder="add tag ⏎" list="kanryo-tags"
                value={newTag} onChange={(e) => setNewTag(e.target.value)} />
              <datalist id="kanryo-tags">
                {[...new Set((allProjects.data ?? []).flatMap((p) => p.tags ?? []))].sort()
                  .map((t) => <option key={t} value={t} />)}
              </datalist>
            </form>
          </div>
          <textarea className="input" rows={2} placeholder="Description" defaultValue={project.description ?? ""}
            onBlur={(e) => (e.target.value || null) !== project.description && patchProject({ description: e.target.value || null })} />
          <form className="settings-row" style={{ marginTop: 10 }} onSubmit={addLink}>
            <input className="input" style={{ maxWidth: 140 }} placeholder="Link label" value={newLink.label}
              onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
            <input className="input" style={{ maxWidth: 240 }} placeholder="https://…" value={newLink.url}
              onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
            <select className="input" style={{ maxWidth: 110 }} value={newLink.kind}
              onChange={(e) => setNewLink({ ...newLink, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k}>{k}</option>)}
            </select>
            <button className="btn" type="submit">Add link</button>
          </form>
          {(links as ProjectLink[]).map((l) => (
            <div key={l.id} className="settings-row">
              <span style={{ fontSize: 13, color: "var(--tx3)" }}>{l.label} — {l.url}</span>
              <button className="icon-btn" onClick={() =>
                api(`/api/links/${l.id}`, { method: "DELETE" }).then(() =>
                  qc.invalidateQueries({ queryKey: ["project", id] }))}>✕</button>
            </div>
          ))}
          <div className="settings-row" style={{ marginTop: 10 }}>
            <button className="btn btn-danger" onClick={() => {
              if (confirm(`Delete "${project.name}" and all its tasks?`)) {
                void api(`/api/projects/${project.id}`, { method: "DELETE" }).then(() => navigate("/"));
              }
            }}>Delete project</button>
          </div>
        </div>
      )}

      {(allLabels.length > 0 || prioFilter !== null || labelFilter.length > 0) && (
        <div className="filter-bar">
          {allLabels.map((l) => (
            <button key={l} className={`chip ${labelFilter.includes(l) ? "on" : ""}`}
              onClick={() => setLabelFilter(labelFilter.includes(l) ? labelFilter.filter((x) => x !== l) : [...labelFilter, l])}>
              {l}
            </button>
          ))}
          {[3, 2, 1].map((p) => (
            <button key={p} className={`chip ${prioFilter === p ? "on" : ""}`}
              onClick={() => setPrioFilter(prioFilter === p ? null : p)}>
              P{p}
            </button>
          ))}
        </div>
      )}

      <form className="quickadd" onSubmit={addTask}>
        <input className="input" placeholder="Add a task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
        <button className="btn btn-primary" type="submit">Add</button>
      </form>

      {isDesktop ? (
        <div className="board">{STATUSES.map(renderColumn)}</div>
      ) : (
        <>
          <div className="seg">
            {STATUSES.map((s) => (
              <button key={s} className={tab === s ? "on" : ""} onClick={() => setTab(s)}>
                {STATUS_LABELS[s]} ({visible(s).length})
              </button>
            ))}
          </div>
          {visible(tab).map((t) => (
            <TaskRow key={t.id} task={t} subtasks={subsOf(t)} onOpen={(x) => setSelectedId(x.id)} />
          ))}
          {tab === "done" && completeButton}
        </>
      )}

      {selected && (
        <TaskDetail task={selected} subtasks={subsOf(selected)} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function LinkChip({ link }: { link: ProjectLink }) {
  const [copied, setCopied] = useState(false);
  // Scheme of 2+ chars: "C:" is a Windows drive prefix, not a scheme. file: is blocked by browsers anyway.
  const navigable = /^[a-z][a-z0-9+.-]+:/i.test(link.url) && !/^file:/i.test(link.url);
  if (navigable) {
    return (
      <a className="link-chip" href={link.url} target="_blank" rel="noreferrer">
        <span>{KIND_ICONS[link.kind]}</span> {link.label}
      </a>
    );
  }
  return (
    <button
      className="link-chip"
      title={`Copy: ${link.url}`}
      onClick={() => {
        void navigator.clipboard.writeText(link.url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1000);
        }).catch(() => {});
      }}
    >
      <span>{KIND_ICONS[link.kind]}</span> {copied ? "copied!" : link.label}
    </button>
  );
}

function Column({ label, status, tasks, onDrop, render, footer }: {
  status: TaskStatus; label: string; tasks: Task[];
  onDrop: (taskId: number, status: TaskStatus) => void;
  render: (t: Task) => React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div className={`column ${over ? "drop" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        onDrop(Number(e.dataTransfer.getData("text/plain")), status);
      }}>
      <h4>{label} ({tasks.length})</h4>
      {tasks.map(render)}
      {footer}
    </div>
  );
}
