import { describe, expect, it } from "vitest";
import { isTextual } from "../worker/mcp";
import { toBriefTask } from "../worker/tasks";

describe("isTextual (the xlsx-as-garbage bug)", () => {
  it("does NOT treat Office formats as text, even though their mime contains 'xml'", () => {
    expect(isTextual("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx")).toBe(false);
    expect(isTextual("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe(false);
    expect(isTextual("application/vnd.openxmlformats-officedocument.presentationml.presentation", "a.pptx")).toBe(false);
  });
  it("does not treat other binaries as text", () => {
    for (const ct of ["application/pdf", "application/zip", "image/png", "application/octet-stream"]) {
      expect(isTextual(ct, "file.bin")).toBe(false);
    }
  });
  it("accepts genuine text types", () => {
    for (const ct of ["text/plain", "text/markdown", "text/csv", "application/json", "application/xml", "image/svg+xml"]) {
      expect(isTextual(ct, "f")).toBe(true);
    }
  });
  it("tolerates a charset suffix and odd casing", () => {
    expect(isTextual("Text/Plain; charset=utf-8", "a.txt")).toBe(true);
  });
  it("falls back to the extension only for generic octet-stream", () => {
    expect(isTextual("application/octet-stream", "notes.md")).toBe(true);
    expect(isTextual("application/octet-stream", "sheet.xlsx")).toBe(false);
  });
});

describe("toBriefTask (context-cheap skim shape)", () => {
  const long = "Stand: waiting on the API key.\n\nDetail line one.\nDetail line two.";
  it("replaces the notes body with its first non-empty line", () => {
    const b = toBriefTask({ id: 1, title: "x", status: "todo", notes: long });
    expect(b.notes).toBeUndefined();
    expect(b.notes_preview).toBe("Stand: waiting on the API key.");
    expect(b.notes_truncated).toBe(true);
  });
  it("keeps every other field", () => {
    const b = toBriefTask({ id: 7, title: "t", status: "done", priority: 2, due_date: "2026-08-01", notes: null });
    expect(b).toMatchObject({ id: 7, title: "t", status: "done", priority: 2, due_date: "2026-08-01" });
  });
  it("marks a single-line note as not truncated", () => {
    const b = toBriefTask({ id: 2, title: "x", notes: "Stand: done." });
    expect(b.notes_preview).toBe("Stand: done.");
    expect(b.notes_truncated).toBe(false);
  });
  it("handles a missing note", () => {
    const b = toBriefTask({ id: 3, title: "x", notes: null });
    expect(b.notes_preview).toBeNull();
    expect(b.notes_truncated).toBe(false);
  });
  it("caps the preview at 200 characters", () => {
    const b = toBriefTask({ id: 4, title: "x", notes: "y".repeat(500) });
    expect(b.notes_preview.length).toBe(200);
    expect(b.notes_truncated).toBe(true);
  });
});
