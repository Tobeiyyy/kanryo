import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Attachment } from "../../shared/types";

/**
 * Photos taken on a phone are 3-8 MB and none of that detail survives being looked at in a
 * task sheet, so images are re-encoded to at most 1600px / JPEG q0.82 before upload. Other
 * file types go up untouched.
 */
async function prepare(file: File): Promise<{ blob: Blob; name: string; type: string }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return { blob: file, name: file.name, type: file.type || "application/octet-stream" };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob) return { blob: file, name: file.name, type: file.type };
    return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg" };
  } catch {
    return { blob: file, name: file.name, type: file.type };
  }
}

export default function Attachments({ taskId }: { taskId: number }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  async function load() {
    setItems(await api<Attachment[]>(`/api/tasks/${taskId}/attachments`));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Paste-to-attach: while the task sheet is open, Ctrl+V with a file or screenshot in the
  // clipboard uploads it. Text pastes into inputs are untouched (no files on the event).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      void upload(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        // Clipboard files all arrive as "image.png"; stamp them so they stay distinguishable.
        const named = file.name === "image.png" || file.name === "image.jpg"
          ? new File([file], `paste-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${file.name.split(".").pop()}`, { type: file.type })
          : file;
        const { blob, name, type } = await prepare(named);
        const res = await fetch(`/api/tasks/${taskId}/attachments`, {
          method: "POST",
          headers: { "content-type": type, "x-filename": encodeURIComponent(name) },
          body: blob,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `upload failed (${res.status})`);
        }
      }
      await load();
      void qc.invalidateQueries({ queryKey: ["project"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(id: number) {
    await api(`/api/attachments/${id}`, { method: "DELETE" });
    await load();
    void qc.invalidateQueries({ queryKey: ["project"] });
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}
    >
      <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>
        Attachments {items.length > 0 && `(${items.length})`}
      </h3>

      {items.length > 0 && (
        <div className="attach-grid">
          {items.map((a) => (
            <div key={a.id} className="attach-item">
              <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" title={a.filename}>
                {a.content_type.startsWith("image/")
                  ? <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" />
                  : <span className="attach-file">{a.filename.split(".").pop()?.toUpperCase() || "FILE"}</span>}
              </a>
              <div className="attach-meta">
                <span className="attach-name" title={a.filename}>{a.filename}</span>
                <button className="icon-btn" title="Remove" onClick={() => remove(a.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => void upload(e.target.files)}
      />
      <button className="link-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? "uploading…" : "+ attach photo or file"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
