import { useState } from "react";
import { useCreateTask } from "../api";

const DRAFT = "kanryo_quickadd_draft";
const UNSENT = "kanryo_quickadd_unsent";

function readUnsent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(UNSENT) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeUnsent(items: string[]) {
  localStorage.setItem(UNSENT, JSON.stringify(items));
}

export default function QuickAdd() {
  const [text, setText] = useState(() => localStorage.getItem(DRAFT) ?? "");
  const [unsent, setUnsent] = useState<string[]>(readUnsent);
  const create = useCreateTask();

  function persist(next: string[]) {
    writeUnsent(next);
    setUnsent(next);
  }

  function send(title: string) {
    create.mutate({ title }, {
      onSuccess: () => persist(readUnsent().filter((t) => t !== title)),
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    // Move the text to the unsent store BEFORE clearing the input — there is no moment
    // where the thought exists only in React state. Removed again only on 2xx.
    persist([...readUnsent(), t]);
    setText("");
    localStorage.removeItem(DRAFT);
    send(t);
  }

  return (
    <div>
      {unsent.length > 0 && (
        <div className="unsent-chip">
          {unsent.length} not sent
          <button className="btn" type="button" onClick={() => unsent.forEach(send)}>
            Retry
          </button>
        </div>
      )}
      <form className="quickadd" onSubmit={submit}>
        <input
          className="input"
          placeholder="Dump an idea…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            localStorage.setItem(DRAFT, e.target.value);
          }}
          enterKeyHint="send"
        />
        <button className="btn btn-primary" type="submit">Add</button>
      </form>
    </div>
  );
}
