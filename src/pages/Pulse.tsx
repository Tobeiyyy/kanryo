import { useEffect, useMemo, useState } from "react";
import { useProjects } from "../api";
import type { ProjectSummary } from "../../shared/types";
import "../styles/pulse.css";

type SortKey = "review" | "total" | "done" | "name";

const FONTS = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

const total = (p: ProjectSummary) => p.review_count + p.todo_count + p.done_count;

function sortProjects(list: ProjectSummary[], key: SortKey) {
  return [...list].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name);
    if (key === "done") return b.done_count - a.done_count;
    if (key === "total") return total(b) - total(a);
    return b.review_count - a.review_count || total(b) - total(a);
  });
}

export default function Pulse() {
  const q = useProjects();
  const [sort, setSort] = useState<SortKey>("review");
  const [tag, setTag] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  // Pulse keeps its own typography; the fonts only load when the page is opened.
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS;
    document.head.appendChild(link);
  }, []);

  const all = q.data ?? [];
  const sums = all.reduce((a, p) => ({ r: a.r + p.review_count, t: a.t + p.todo_count, d: a.d + p.done_count }), { r: 0, t: 0, d: 0 });
  const tags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of all) for (const t of p.tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 8);
  }, [all]);
  const max = all.reduce((m, p) => Math.max(m, total(p)), 1);
  const list = sortProjects(tag ? all.filter((p) => p.tags?.includes(tag)) : all, sort);
  const worst = sortProjects(all, "review")[0];

  return (
    <div className="pulse">
      <header>
        <div>
          <h1>Kanryo Pulse</h1>
          <p className="sub">Every active project, sorted by how much is still undecided.</p>
        </div>
      </header>

      <div className="tiles">
        <div className="tile lead" style={{ "--seg": "var(--pl-review)" } as React.CSSProperties}>
          <span className="k">In review</span>
          <span className="v">{q.data ? sums.r : "–"}</span>
          <span className="n">Undecided. Nothing moves until these are chosen or dropped.</span>
        </div>
        <div className="tile" style={{ "--seg": "var(--pl-todo)" } as React.CSSProperties}>
          <span className="k">To do</span>
          <span className="v">{q.data ? sums.t : "–"}</span>
          <span className="n">Decided and waiting to be worked.</span>
        </div>
        <div className="tile" style={{ "--seg": "var(--pl-done)" } as React.CSSProperties}>
          <span className="k">Done</span>
          <span className="v">{q.data ? sums.d : "–"}</span>
          <span className="n">Finished across all active projects.</span>
        </div>
      </div>
      <p className="caption">
        {!q.data
          ? "Reading the board…"
          : `${all.length} active projects. ` + (worst && worst.review_count > 0
            ? `${worst.name} carries the largest review backlog at ${worst.review_count} item${worst.review_count === 1 ? "" : "s"}.`
            : "Nothing is sitting in review.")}
      </p>

      <div className="controls">
        <label htmlFor="pulse-sort">Sort</label>
        <select id="pulse-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="review">Review backlog</option>
          <option value="total">Total items</option>
          <option value="done">Done</option>
          <option value="name">Name</option>
        </select>
        <button className="tgl" aria-pressed={table} onClick={() => setTable(!table)}>Table view</button>
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className="chip" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>{t}</button>
          ))}
        </div>
      </div>

      <div className="legend">
        <span><i className="sw" style={{ background: "var(--pl-review)" }} />Review</span>
        <span><i className="sw" style={{ background: "var(--pl-todo)" }} />To do</span>
        <span><i className="sw" style={{ background: "var(--pl-done)" }} />Done</span>
        <span style={{ color: "var(--pl-ink-3)" }}>Bar length is the project's size against the largest board.</span>
      </div>

      {!q.data ? (
        <div className="rows loading">
          {[82, 64, 71, 45, 58, 38, 50].map((w, i) => (
            <div className="row" key={i}>
              <div className="name"><span className="t"><span className="skel" style={{ display: "inline-block", width: `${w}%`, height: 12 }} /></span></div>
              <div className="track"><span className="skel" style={{ width: `${Math.max(18, w - 22)}%` }} /></div>
              <div className="counts"><i className="c-0">–</i><i className="c-0">–</i><i className="c-0">–</i></div>
            </div>
          ))}
        </div>
      ) : table ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Project</th><th>Tags</th>
                <th style={{ textAlign: "right" }}>Review</th><th style={{ textAlign: "right" }}>To do</th>
                <th style={{ textAlign: "right" }}>Done</th><th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td style={{ color: "var(--pl-ink-3)" }}>{(p.tags ?? []).join(" · ")}</td>
                  <td className="num">{p.review_count}</td>
                  <td className="num">{p.todo_count}</td>
                  <td className="num">{p.done_count}</td>
                  <td className="num">{total(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rows">
          {list.map((p) => {
            const tot = total(p);
            const share = tot === 0 ? 0 : Math.max(4, Math.round((tot / max) * 100));
            const segs: [number, string, string][] = [
              [p.review_count, "review", "in review"], [p.todo_count, "todo", "to do"], [p.done_count, "done", "done"],
            ];
            return (
              <div className="row" key={p.id}>
                <div>
                  <div className="name">
                    {p.icon && <span className="ic">{p.icon}</span>}
                    <span className="t">{p.name}</span>
                  </div>
                  {p.tags?.length > 0 && <div className="tags">{p.tags.join(" · ")}</div>}
                </div>
                <div className="track">
                  {tot > 0 && (
                    <span className="bar" style={{ width: `${share}%` }}>
                      {segs.filter(([n]) => n > 0).map(([n, key, label]) => (
                        <span
                          key={key} className="pl-seg" style={{ background: `var(--pl-${key})`, flex: n }}
                          onMouseMove={(e) => setTip({ text: `${p.name} — ${n} ${label}`, x: e.clientX, y: e.clientY })}
                          onMouseLeave={() => setTip(null)}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <div className="counts">
                  <i className={p.review_count ? "c-r" : "c-0"} title="in review">{p.review_count}</i>
                  <i className={p.todo_count ? "c-t" : "c-0"} title="to do">{p.todo_count}</i>
                  <i className={p.done_count ? "c-d" : "c-0"} title="done">{p.done_count}</i>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tip && (
        <div className="pulse-tip" role="status" style={{ left: Math.min(tip.x + 12, innerWidth - 260), top: Math.max(8, tip.y - 34) }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
