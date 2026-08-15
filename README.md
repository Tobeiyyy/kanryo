# Kanryo

If you combine a kanban board, a notes inbox and Claude's memory you would probably
get something like Kanryo. It is a project board for exactly one person, it runs on
Cloudflare's free tier, and it serves an MCP endpoint so every Claude surface reads
and writes the same board I tap on my phone. 完了 (*kanryo*) means "completed".

![Dashboard](docs/screenshots/dashboard.png)

## Why I built this

I did not need a team tool. I needed a place to throw ideas at 11pm without filling
in five fields first, and I wanted Claude to still know about them next week.

That second part is the real reason this exists. Chats forget. Claude Code forgets.
I got really tired of re-explaining my own projects to a model that helped me build
them, so the board became the memory instead. A chat can look up what is still open,
close a task when we finish something, or read a note I wrote in June and completely
forgot about. Is that overkill for a to-do list? Probably. It also works.

## What it does

Tasks sit in three columns: to review, to do, done. New ones land in "to review",
which is my way of saying I have not committed to this yet. That column turned into
a list of things I want to talk through with Claude first, and honestly, that one
rule is what keeps the to-do column believable.

![Project board](docs/screenshots/project-board.png)

Capture is one box at the top of the dashboard. Type the thought, press enter,
about five seconds on a phone. No project, no priority, nothing to fill in. It
lands in an inbox and gets sorted later, by me in one tap or by Claude when I ask
it to triage. Whatever you type is mirrored to localStorage on every keystroke and
kept with a visible retry if the request fails. I lost exactly one idea to a train
tunnel and never again.

Projects hold a description, tags and links: a repo, a live URL, a folder path on
your machine, a Claude chat. Tags group related projects and filter the dashboard.

Tasks have priorities, labels, subtasks, due dates and attachments. Photos and
files go to R2, images get downscaled in the browser first cause a 6MB phone photo
helps nobody. Claude can actually look at the attachments, which sounds like a
gimmick and really isn't. I screenshot a bug on my phone, attach it, and a chat two
days later can see exactly what I saw.

Give a task a due date and it appears as an event on a Google Calendar you set
aside for it. Finish the task, the event disappears. All the reminding is Google's
job, so this app sends no notifications at all.

Finished projects fold into a drawer at the bottom of the dashboard. Projects with
nothing open left just fade out where they stand.

![Task detail](docs/screenshots/task-detail.png)

## Stack

React 18, Vite, TypeScript, Hono on Cloudflare Workers, D1, R2, plain CSS with
design tokens. TanStack Query is the only real frontend dependency. At one person's
volume everything fits in the free tier.

## Setup

You need a Cloudflare account and Node 20 or newer.

```bash
git clone https://github.com/Tobeiyyy/kanryo.git
cd kanryo
npm install
npx wrangler login
npm run setup
```

`npm run setup` creates the D1 database and R2 bucket, writes the database id into
`wrangler.jsonc`, sets the secrets (asks for a password or generates one), applies
the schema and deploys. At the end it prints your app URL, your login password and
your Claude connector URL. That's the whole install.

On a phone: open the URL, log in, Share, "Add to Home Screen".

<details>
<summary>Manual setup, if you'd rather see every step</summary>

```bash
npx wrangler d1 create kanryo          # put the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create kanryo-files
npm run migrate:remote
npx wrangler secret put APP_PASSWORD   # what you log in with
npx wrangler secret put AUTH_SECRET    # any long random string
npx wrangler secret put KANRYO_TOKEN   # long random hex, used by Claude
npm run deploy
```

Windows note: piping a string into `wrangler secret put` in PowerShell appends a
newline and quietly corrupts the value. Use `npx wrangler secret bulk secrets.json`.

</details>

## Google Calendar (optional)

Kanryo writes to one calendar you set aside for it through a service account, so
there is no OAuth flow and nothing to refresh. This is the fiddliest part of the
whole setup, and it is skippable.

1. In Google Cloud: pick or create a project, enable the Google Calendar API,
   create a service account, download a JSON key. It needs no IAM roles.
2. Set two secrets from that file:
   ```bash
   npx wrangler secret put GCAL_CLIENT_EMAIL   # client_email
   npx wrangler secret put GCAL_PRIVATE_KEY    # private_key, newlines included
   ```
3. In Google Calendar: create a calendar, share it with the service account's email
   address, give it "Make changes to events".
4. Paste that calendar's ID into Kanryo's settings page.

Due dates then show up on that calendar within seconds. With a time it becomes a
30 minute event, otherwise all day.

## Using it with Claude

The worker serves MCP at `/mcp/<KANRYO_TOKEN>`, with tools for reading and writing
projects and tasks, filing inbox items, tagging, and viewing attachments.

In claude.ai: Settings, Connectors, add a custom connector pointing at

```
https://<your-worker>.workers.dev/mcp/<KANRYO_TOKEN>
```

The token in the path is the authentication, so treat that whole URL like a
password. (`npm run setup` prints it ready to paste.)

Then there is [`skill/SKILL.md`](skill/SKILL.md), and I would argue it matters more
than the tools do. It tells Claude to close a task the moment you say you finished
it, no asking, but to always ask before creating or deleting anything. My first
version asked permission for every single write. I stopped using it within a day.
Replace the placeholder URL inside, zip it in a folder called `kanryo`, upload it
under Settings, Capabilities, Skills. Claude Code reads it from
`~/.claude/skills/kanryo/` instead.

After that a chat can handle "what is on my review list for the recipe app" or "we
finished the offline mode, mark it done".

![Completed projects](docs/screenshots/completed-projects.png)

## Decisions that might look like gaps

One password, one bearer token, that is the whole auth model. Accounts would mean a
user table, sessions and per-row ownership, for exactly one user. No.

Recurring tasks are missing on purpose. I tried them, hated the noise, and moved my
habits somewhere else entirely.

No push notifications either, for a duller reason: Google Calendar already sends
them and I refuse to build a second thing that pings my phone.

Calendar sync writes its failure state first. Any change that affects an event
marks the task dirty in the same database write, then converges in the background.
If the worker dies halfway, the flag survives and the next app load retries.
Deleted tasks leave a tombstone so their event still gets cleaned up.

## Development

```bash
npm run dev        # vite plus worker against a local D1
npm test           # vitest
npm run check      # typecheck
```

The dev server uses a local database, so seed it with whatever nonsense you like.

## Who this is for

If you just want a kanban board there are a hundred better maintained ones. The
people who will get something out of Kanryo are the ones already living half their
projects inside Claude, who are tired of every chat starting from zero. For that
specific problem, this is the best tool I know of, mostly because I built it around
exactly that annoyance.

## License

MIT, see [LICENSE](LICENSE).
