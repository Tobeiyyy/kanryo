import { describe, expect, it } from "vitest";
import { feedUrl, htmlToText, parseSavedFeed, toBriefSaved } from "../worker/reddit";

// A real comment entry as www.reddit.com serves it, plus a post entry in the same format.
const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/AutoModerator</name><uri>https://www.reddit.com/user/AutoModerator</uri></author><category term="ClaudeAI" label="r/ClaudeAI" /><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Your post will be reviewed shortly.&lt;/p&gt; &lt;p&gt;&lt;em&gt;I am a bot &amp;amp; friendly.&lt;/em&gt;&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;</content><id>t1_pcuwbw1</id><link href="https://www.reddit.com/r/ClaudeAI/comments/1wtk9kd/x/pcuwbw1/"/><updated>2026-09-29T19:53:44+00:00</updated><title>/u/AutoModerator on Anthropic says a model &amp;quot;can&amp;quot; build</title></entry>
<entry><author><name>/u/someone</name><uri>https://www.reddit.com/user/someone</uri></author><category term="selfhosted" label="r/selfhosted"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Line one&lt;br/&gt;line two&lt;/p&gt;&lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/someone&quot;&gt; /u/someone &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://example.com/tool&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content><id>t3_1abc</id><link href="https://www.reddit.com/r/selfhosted/comments/1abc/my_tool/"/><updated>2026-09-28T10:00:00+00:00</updated><published>2026-09-28T09:00:00+00:00</published><title>My tool</title></entry>
</feed>`;

describe("parseSavedFeed", () => {
  const items = parseSavedFeed(FEED);
  it("reads posts and comments with their metadata", () => {
    expect(items.map((i) => [i.id, i.kind, i.subreddit, i.author])).toEqual([
      ["t1_pcuwbw1", "comment", "r/ClaudeAI", "/u/AutoModerator"],
      ["t3_1abc", "post", "r/selfhosted", "/u/someone"],
    ]);
    expect(items[1].url).toBe("https://www.reddit.com/r/selfhosted/comments/1abc/my_tool/");
    expect(items[0].updated).toBe("2026-09-29T19:53:44+00:00");
  });
  it("turns the double-escaped HTML into readable text", () => {
    expect(items[0].title).toBe('/u/AutoModerator on Anthropic says a model "can" build');
    expect(items[0].text).toBe("Your post will be reviewed shortly.\nI am a bot & friendly.");
    expect(items[1].text).toContain("Line one\nline two");
    expect(items[1].text).toContain("[link: https://example.com/tool]");
  });
  it("returns nothing for a non-feed body", () => {
    expect(parseSavedFeed("<html>blocked</html>")).toEqual([]);
  });
});

describe("feed helpers", () => {
  it("forces www.reddit.com and a limit, keeping the private token", () => {
    const u = new URL(feedUrl("https://old.reddit.com/user/tobe/saved.rss?feed=abc123&user=tobe", 500));
    expect(u.hostname).toBe("www.reddit.com");
    expect(u.searchParams.get("feed")).toBe("abc123");
    expect(u.searchParams.get("limit")).toBe("100");
  });
  it("cuts long text to an excerpt in the brief shape", () => {
    const b = toBriefSaved({ id: "t3_x", kind: "post", title: "t", subreddit: null, author: null, url: "u", updated: null, text: "y".repeat(500) });
    expect(b).not.toHaveProperty("text");
    expect(b.excerpt.length).toBe(301);
  });
  it("leaves plain text alone", () => {
    expect(htmlToText("plain")).toBe("plain");
  });
});
