import { describe, expect, it } from "vitest";
import { isConvertibleDocument, isTextual, pageText } from "../worker/mcp";
import { toBriefTask } from "../worker/tasks";
import { extractJpegPages, hasRealText } from "../worker/pdfImages";

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

describe("isConvertibleDocument (what goes through toMarkdown)", () => {
  it("converts pdf and office/odf documents, by extension or pdf mime", () => {
    expect(isConvertibleDocument("application/octet-stream", "Klausur.PDF")).toBe(true);
    expect(isConvertibleDocument("application/pdf", "noext")).toBe(true);
    for (const f of ["a.docx", "a.xlsx", "a.xls", "a.odt", "a.ods", "a.numbers"]) {
      expect(isConvertibleDocument("application/octet-stream", f)).toBe(true);
    }
  });
  it("leaves images and archives alone (images would cost AI neurons)", () => {
    expect(isConvertibleDocument("image/png", "shot.png")).toBe(false);
    expect(isConvertibleDocument("application/zip", "a.zip")).toBe(false);
    expect(isConvertibleDocument("application/vnd.ms-powerpoint", "a.pptx")).toBe(false);
  });
});

describe("pageText (long documents in parts)", () => {
  it("returns one part for short text", () => {
    expect(pageText("hello", 1, 10)).toEqual({ body: "hello", part: 1, parts: 1 });
  });
  it("splits into parts and serves the requested one", () => {
    const t = "a".repeat(10) + "b".repeat(10) + "c".repeat(5);
    expect(pageText(t, 2, 10)).toEqual({ body: "b".repeat(10), part: 2, parts: 3 });
    expect(pageText(t, 3, 10).body).toBe("ccccc");
  });
  it("clamps out-of-range and garbage part numbers", () => {
    const t = "x".repeat(25);
    expect(pageText(t, 99, 10).part).toBe(3);
    expect(pageText(t, 0, 10).part).toBe(1);
    expect(pageText(t, NaN, 10).part).toBe(1);
  });
});

describe("hasRealText (scanned PDFs convert to empty scaffolding)", () => {
  it("sees no text in metadata plus empty page headings", () => {
    const scan = "# a.pdf\n## Metadata\n- PDFFormatVersion=1.6\n- IsLinearized=false\n\n## Contents\n### Page 1\n\n\n### Page 2\n";
    expect(hasRealText(scan)).toBe(false);
  });
  it("sees text when pages have content", () => {
    expect(hasRealText("## Contents\n### Page 1\nAufgabe 1: Berechnen Sie die Ableitung von f(x) = x^2 sin(x).")).toBe(true);
  });
});

describe("extractJpegPages (scanned page images)", () => {
  const jpeg = (fill: number) => [0xff, 0xd8, fill, fill, fill, 0xff, 0xd9];
  function pdf(parts: (string | number[])[]): ArrayBuffer {
    const bytes: number[] = [];
    for (const p of parts) bytes.push(...(typeof p === "string" ? [...p].map((ch) => ch.charCodeAt(0)) : p));
    return new Uint8Array(bytes).buffer;
  }
  it("cuts out each DCTDecode image stream as a complete JPEG, in order", async () => {
    const buf = pdf([
      "%PDF-1.6\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter /DCTDecode /Length 7 >>\nstream\r\n", jpeg(1), "\nendstream\nendobj\n",
      "2 0 obj\n<< /Filter /FlateDecode /Length 3 >>\nstream\nabc\nendstream\nendobj\n",
      "3 0 obj\n<< /Subtype /Image /Filter [/DCTDecode] /Length 9 0 R >>\nstream\n", jpeg(2), "\r\nendstream\nendobj\n",
    ]);
    const pages = await extractJpegPages(buf);
    expect(pages.map((p) => [...p])).toEqual([jpeg(1), jpeg(2)]);
  });
  it("unwraps zlib-compressed JPEGs the way iLovePDF writes them", async () => {
    const zipped = new Uint8Array(await new Response(
      new Blob([new Uint8Array(jpeg(3))]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer());
    const buf = pdf([
      `4 0 obj\n<<\n/Subtype /Image\n/Filter [/FlateDecode /DCTDecode]\n/DecodeParms [null << /Quality 60 >>]\n/Length ${zipped.length}\n>>\nstream\n`,
      [...zipped], "\nendstream\nendobj\n",
    ]);
    expect((await extractJpegPages(buf)).map((p) => [...p])).toEqual([jpeg(3)]);
  });
  it("ignores images in other encodings", async () => {
    const buf = pdf(["1 0 obj\n<< /Subtype /Image /Filter /JBIG2Decode >>\nstream\n", jpeg(4), "\nendstream\nendobj\n"]);
    expect(await extractJpegPages(buf)).toEqual([]);
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
