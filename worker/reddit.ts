/**
 * Saved Reddit posts via the private RSS feed (old.reddit.com/prefs/feeds, "saved" feed).
 * The API needs a manually approved app since 2026; the token feed does not. From Workers,
 * www.reddit.com serves the feed while old.reddit.com answers with an HTML block page, so the
 * host is always rewritten to www.
 */
export type RedditSaved = {
  id: string;             // t3_... for posts, t1_... for comments
  kind: "post" | "comment";
  title: string;
  subreddit: string | null;
  author: string | null;
  url: string;
  updated: string | null;
  text: string;
};

const EXCERPT = 300;

export function feedUrl(raw: string, limit: number): string {
  const u = new URL(raw.trim());
  u.hostname = "www.reddit.com";
  u.searchParams.set("limit", String(Math.min(Math.max(1, limit), 100)));
  return u.toString();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Reddit's <content> is HTML escaped inside XML: unescape once, drop tags, unescape again. */
export function htmlToText(escaped: string): string {
  const html = decodeEntities(escaped);
  const text = html
    .replace(/<!--.*?-->/gs, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|blockquote|pre|tr)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>\s*\[link\]\s*<\/a>/gi, "[link: $1]")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function tag(entry: string, name: string): string | null {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry);
  return m ? m[1] : null;
}

export function parseSavedFeed(xml: string): RedditSaved[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.map((e) => {
    const id = (tag(e, "id") ?? "").trim();
    const author = tag(tag(e, "author") ?? "", "name");
    return {
      id,
      kind: id.startsWith("t1_") ? "comment" : "post",
      // Titles are plain text but Reddit sometimes escapes them twice (&amp;quot;).
      title: decodeEntities(decodeEntities(tag(e, "title") ?? "")).trim(),
      subreddit: /<category[^>]*label="([^"]+)"/.exec(e)?.[1] ?? null,
      author: author ? author.trim() : null,
      url: /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? "",
      updated: (tag(e, "updated") ?? tag(e, "published"))?.trim() ?? null,
      text: htmlToText(tag(e, "content") ?? ""),
    };
  });
}

export function toBriefSaved(s: RedditSaved) {
  const { text, ...rest } = s;
  return { ...rest, excerpt: text.length > EXCERPT ? text.slice(0, EXCERPT) + "…" : text };
}

const CACHE_KEY = "reddit_saved_cache";
const CACHE_MS = 5 * 60 * 1000;

/**
 * Claude chains list -> get -> import within seconds, and Reddit rate-limits a feed fetched
 * that often. The parsed feed is kept in settings for five minutes; when Reddit answers 429,
 * the last good copy is served however old it is, with its age, rather than an error.
 */
export async function savedWithCache(
  db: D1Database, feed: string,
): Promise<{ items: RedditSaved[]; fetched_at: string; stale: boolean }> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(CACHE_KEY)
    .first<{ value: string }>();
  // Keyed by a hash of the feed URL (it holds the token), so swapping feeds never serves the old one.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(feed.trim()));
  const feedHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const parsed = row ? (JSON.parse(row.value) as { feed: string; fetched_at: string; items: RedditSaved[] }) : null;
  const cached = parsed?.feed === feedHash ? { fetched_at: parsed.fetched_at, items: parsed.items } : null;
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_MS) return { ...cached, stale: false };
  try {
    const items = await fetchSaved(feed);
    const fetched_at = new Date().toISOString();
    await db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).bind(CACHE_KEY, JSON.stringify({ feed: feedHash, fetched_at, items })).run();
    return { items, fetched_at, stale: false };
  } catch (e) {
    if (cached && e instanceof Error && e.message.startsWith("Reddit is rate-limiting")) return { ...cached, stale: true };
    throw e;
  }
}

export async function fetchSaved(feed: string, limit = 100): Promise<RedditSaved[]> {
  const res = await fetch(feedUrl(feed, limit), {
    headers: { "user-agent": "kanryo/1.0 (personal saved-posts reader)" },
  });
  if (res.status === 403 || res.status === 401) {
    throw new Error("Reddit refused the saved feed (token wrong or reset) — copy a fresh saved-feed URL from old.reddit.com/prefs/feeds");
  }
  if (res.status === 429) throw new Error("Reddit is rate-limiting right now, try again in a minute");
  if (!res.ok) throw new Error(`Reddit answered ${res.status}`);
  const body = await res.text();
  if (!body.includes("<feed")) throw new Error("Reddit did not return a feed — check the saved-feed URL");
  return parseSavedFeed(body);
}
