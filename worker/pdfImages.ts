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
