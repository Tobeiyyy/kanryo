import { useState } from "react";
import { useInbox } from "../api";
import type { Task } from "../../shared/types";
import ClassifySheet from "../components/ClassifySheet";

export default function Inbox() {
  const inbox = useInbox();
  const [active, setActive] = useState<Task | null>(null);
  return (
    <div>
      <h1>Inbox</h1>
      {inbox.data?.length === 0 && <p style={{ color: "var(--tx3)" }}>Empty. Nice.</p>}
      {inbox.data?.map((t) => (
        <div key={t.id} className="card inbox-row" onClick={() => setActive(t)}>
          <span>{t.title}</span>
          <time>{t.created_at.slice(0, 10)}</time>
        </div>
      ))}
      {active && <ClassifySheet task={active} onClose={() => setActive(null)} />}
    </div>
  );
}
