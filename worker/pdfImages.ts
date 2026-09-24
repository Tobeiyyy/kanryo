/**
 * Scanned PDFs (phone scanners, iLovePDF, ...) store each page as one JPEG image stream,
 * either verbatim (/DCTDecode) or zlib-wrapped (/FlateDecode /DCTDecode, iLovePDF does this).
 * Either way the JPEG file can be cut out without rendering anything. Returned in file order.
 */
export async function extractJpegPages(buf: ArrayBuffer): Promise<Uint8Array[]> {
  const bytes = new Uint8Array(buf);
  // windows-1252 is one char per byte, so string offsets equal byte offsets.
  const text = new TextDecoder("windows-1252").decode(bytes);
  const out: Uint8Array[] = [];
  let i = 0;
  while ((i = text.indexOf("stream", i)) !== -1) {
    if (text.slice(i - 3, i) === "end") { i += 6; continue; }
    const dict = text.slice(text.lastIndexOf(" obj", i), i);
    let start = i + 6;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const end = text.indexOf("endstream", start);
    if (end === -1) break;
    i = end + 9;
    if (!/\/Subtype\s*\/Image/.test(dict)) continue;
    const plain = /\/Filter\s*(?:\/DCTDecode|\[\s*\/DCTDecode\s*\])/.test(dict);
    const zipped = /\/Filter\s*\[\s*\/FlateDecode\s*\/DCTDecode\s*\]/.test(dict);
    if (!plain && !zipped) continue;
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    let data: Uint8Array = length ? bytes.subarray(start, start + Number(length[1])) : bytes.subarray(start, end);
    if (zipped) {
      try { data = await inflate(data); } catch { continue; }
    }
    const jpeg = trimToJpegEnd(data);
    if (jpeg) out.push(jpeg);
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Drops trailing whitespace/padding after the JPEG end-of-image marker. */
function trimToJpegEnd(data: Uint8Array): Uint8Array | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let stop = data.length;
  while (stop > 3 && !(data[stop - 2] === 0xff && data[stop - 1] === 0xd9)) stop--;
  return stop > 3 ? data.subarray(0, stop) : null;
}

/**
 * toMarkdown returns a metadata block and a heading per page even when a PDF has no text
 * layer at all. Real text is whatever is left once that scaffolding is removed.
 */
export function hasRealText(markdown: string): boolean {
  const body = markdown
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && !/^\s*-\s*\w+=/.test(l))
    .join("")
    .trim();
  return body.length >= 50;
}

/** JPEG bytes per view_attachment call; base64 makes the response about a third larger. */
export const SCAN_BYTES_PER_CALL = 3 * 1024 * 1024;

/**
 * Which scanned pages (0-based, inclusive) to return in one call. Starts at `pages` ("5" or
 * "5-9", 1-based) or at the first page of greedy chunk `part` (kept for clients that learned
 * the old part-based paging), then takes pages in order until the byte budget is spent. A
 * single page larger than the budget still goes out alone. `rest` is what is left of the
 * requested range, so the reply can say exactly where to continue. Null for malformed pages.
 */
export function pickScanPages(
  sizes: number[], req: { pages?: unknown; part?: unknown }, budget = SCAN_BYTES_PER_CALL,
): { from: number; to: number; rest: [number, number] | null } | null {
  const total = sizes.length;
  let start = 0;
  let end = total - 1;
  if (req.pages !== undefined && req.pages !== null && req.pages !== "") {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(String(req.pages));
    if (!m) return null;
    start = Math.min(Math.max(1, Number(m[1])), total) - 1;
    end = Math.min(Math.max(start + 1, Number(m[2] ?? m[1])), total) - 1;
  } else if (req.part !== undefined) {
    const wanted = Math.max(1, Math.floor(Number(req.part)) || 1);
    let chunk = 1;
    let used = 0;
    for (let i = 0; i < total; i++) {
      if (i > start && used + sizes[i] > budget) {
        if (chunk === wanted) break;
        chunk++; start = i; used = 0;
      }
      used += sizes[i];
    }
  }
  let to = start;
  let used = sizes[start];
  while (to < end && used + sizes[to + 1] <= budget) { to++; used += sizes[to]; }
  return { from: start, to, rest: to < end ? [to + 1, end] : null };
}
