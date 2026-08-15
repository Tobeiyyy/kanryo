# Kanryo

A kanban board for one person, running on Cloudflare's free tier. It installs on
your phone as a PWA and serves an MCP endpoint, so Claude reads and writes the same
board you tap on. 完了 (*kanryo*) means "completed".

![Dashboard](docs/screenshots/dashboard.png)

## Why

I did not need a team tool. I needed somewhere to put ideas at 11pm without filling
in five fields first, and I wanted Claude to still know about them next week.

That second half is really why this exists. Chats forget. Claude Code forgets. I got
tired of re-explaining the same project every time I opened a new conversation, so
the board became the memory instead: a chat can look up what is still open, close
something when we finish it, or read a note I wrote in June and have not thought
about since.

## What it does

Tasks sit in three columns: to review, to do, done. New ones land in "to review",
which is my way of saying I have not committed to it yet. That column turned into a
list of things I want to talk through with Claude, and the to-do column stayed
believable as a result.

![Project board](docs/screenshots/project-board.png)

Capture is one box at the top of the dashboard. Type the thought, press enter, about
five seconds on a phone. No project, no priority, nothing to fill in. Whatever you
type is mirrored to localStorage as you type it and kept with a retry if the request
fails, because losing an idea to a tunnel once was enough.

Projects carry a description, tags, and links, which can be a repo, a live URL, a
Windows folder path or a Claude chat. Tags also filter the dashboard.

Tasks have the usual priorities, labels, subtasks and due dates. You can attach
photos and files, which go to R2; images get downscaled in the browser first, since
a 6MB phone photo helps nobody. Claude can look at those attachments, which is
oddly handy for screenshots of your own bugs.

Give a task a due date and it shows up as an event on a Google Calendar you set
aside for it. Finish the task and the event disappears. All the reminding is
Google's job.

Finished projects fold into a drawer at the bottom. Projects with nothing open left
just fade out where they are.

![Task detail](docs/screenshots/task-detail.png)

## Stack

React 18, Vite, TypeScript, Hono on Cloudflare Workers, D1, R2, and plain CSS with
design tokens. TanStack Query is the only real dependency in the frontend. At one
person's volume it all sits inside the free tier.

## Setup

You need a Cloudflare account and Node 20 or newer.

```bash
git clone https://github.com/Tobeiyyy/kanryo.git
cd kanryo
npm install
npx wrangler login
```

Create the database and the bucket:

```bash
npx wrangler d1 create kanryo
npx wrangler r2 bucket create kanryo-files
```

Put the `database_id` that the first command prints into `wrangler.jsonc`, replacing
the one already there. Then apply the schema:

```bash
npm run migrate:remote      # npm run migrate:local for local dev
```

Set three secrets:

```bash
npx wrangler secret put APP_PASSWORD    # what you log in with
npx wrangler secret put AUTH_SECRET     # any long random string
npx wrangler secret put KANRYO_TOKEN    # long random hex, used by Claude below
```

Windows note: piping a string into `wrangler secret put` in PowerShell appends a
newline and quietly corrupts the value. Use `npx wrangler secret bulk secrets.json`.

Deploy:

```bash
npm run deploy
```

Open the `*.workers.dev` URL it prints, log in with `APP_PASSWORD`, and on a phone
use Share, then "Add to Home Screen".

## Google Calendar (optional)

Kanryo writes to one calendar you set aside for it through a service account, so
there is no OAuth flow and nothing to refresh.

1. In Google Cloud, pick or create a project, enable the Google Calendar API, create
   a service account and download a JSON key. It needs no IAM roles.
2. Set two secrets from that file:
   ```bash
   npx wrangler secret put GCAL_CLIENT_EMAIL   # client_email
   npx wrangler secret put GCAL_PRIVATE_KEY    # private_key, newlines included
   ```
3. In Google Calendar, create a calendar and share it with the service account's
   email address, giving it "Make changes to events".
4. Paste that calendar's ID into Kanryo's settings page.

Due dates then appear on that calendar within seconds. With a time it becomes a 30
minute event, otherwise it is all day.

## Using it with Claude

The worker serves MCP at `/mcp/<KANRYO_TOKEN>`, with tools for reading and writing
projects and tasks, filing inbox items, tagging, and viewing attachments.

In claude.ai, go to Settings, then Connectors, and add a custom connector pointing
at:

```
https://<your-worker>.workers.dev/mcp/<KANRYO_TOKEN>
```

The token sits in the path and is what authenticates the call, so treat the whole
URL like a password.

Then there is [`skill/SKILL.md`](skill/SKILL.md), which matters more than the tools
did. It tells Claude to close a task the moment you say you finished it, and to ask
first before creating or deleting anything. My first version asked permission for
every single write and I stopped using it within a day. Replace the placeholder URL
inside, zip it in a folder called `kanryo`, and upload it under Settings,
Capabilities, Skills. Claude Code reads it from `~/.claude/skills/kanryo/` instead.

After that a chat can handle "what is on my review list for the recipe app" or "we
finished the offline mode, mark it done".

![Completed projects](docs/screenshots/completed-projects.png)

## Decisions that might look like gaps

There is one password and one bearer token, and that is the whole auth model. Adding
accounts would drag in a user table, sessions and per-row ownership to serve exactly
one person.

Recurring tasks are missing on purpose. I tried them, hated the noise, and moved
habits somewhere else.

Push notifications are missing for a duller reason: Google Calendar already sends
them, and I did not want to build a second thing that pings my phone.

Calendar sync writes its failure state before it tries anything. A change that
affects an event marks the task dirty in the same database write, then converges in
the background. If the worker dies halfway the flag survives and the next app load
picks it up again. Deleted tasks leave a tombstone behind so their event can still
be cleaned up.

## Development

```bash
npm run dev        # vite plus worker against a local D1
npm test           # vitest
npm run check      # typecheck
```

The dev server uses a local database, so seed it with whatever nonsense you like
without touching the real board.

## License

MIT, see [LICENSE](LICENSE).
