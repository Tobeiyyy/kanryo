# Kanryo

A kanban board for one person. It runs on Cloudflare's free tier, installs on your
phone as a PWA, and exposes an MCP endpoint so Claude can read and write the same
board you tap on. 完了 (*kanryo*) means "completed".

![Dashboard](docs/screenshots/dashboard.png)

## Why

Most task apps are built for teams and priced per seat. This one assumes a single
user: one password, no accounts, no sharing, no sync service. It costs nothing to
run and the data stays in your own Cloudflare account.

The reason I built it rather than using something off the shelf is the Claude part.
The board is working memory that survives between chats, so a conversation can
create a project from something we just designed, close a task when the work is
actually done, or read notes I left two months ago.

## What it does

Tasks live in three columns instead of the usual two: **to review**, **to do**,
**done**. New tasks start in "to review", which means "not committed to yet". In
practice that column became a list of things to talk through with Claude before
they turn into real work, which keeps the to-do column honest.

![Project board](docs/screenshots/project-board.png)

Other things it does:

* A quick-add bar on the dashboard dumps a raw thought with no project and no
  fields, so capture takes about five seconds on a phone. What you type is copied
  to localStorage on every keystroke and kept with a visible retry if the request
  fails, so an idea can't vanish because the train went into a tunnel.
* Projects hold a description, tags, and links: a repo, a live URL, a folder path,
  a Claude chat. Tags group related projects and can filter the dashboard.
* Tasks take priorities, labels, subtasks, due dates and attachments. Photos and
  files go to R2, and images are downscaled in the browser before upload.
* A task with a due date becomes an event on a Google Calendar you dedicate to it.
  Completing the task removes the event. Reminders come from Google's own settings,
  so the app has no notification system of its own.
* Finished projects collapse into a drawer instead of cluttering the dashboard.
  Projects with nothing left to do fade out on their own.

![Task detail](docs/screenshots/task-detail.png)

## Stack

React 18, Vite, TypeScript, Hono on Cloudflare Workers, D1 for data, R2 for files,
plain CSS with design tokens. No UI framework, no ORM, no state library beyond
TanStack Query. At personal volumes everything fits in the free tier.

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

On Windows PowerShell, piping a string into `wrangler secret put` appends a newline
and quietly corrupts the value. Use `npx wrangler secret bulk secrets.json` there.

Deploy:

```bash
npm run deploy
```

Open the `*.workers.dev` URL it prints, log in with `APP_PASSWORD`, and on a phone
use Share, then "Add to Home Screen".

## Google Calendar (optional)

Kanryo writes to one calendar you set aside for it, using a service account, so
there is no OAuth flow and no refresh tokens to store.

1. In Google Cloud, pick or create a project, enable the Google Calendar API,
   create a service account and download a JSON key. It needs no IAM roles.
2. Set two secrets from that file:
   ```bash
   npx wrangler secret put GCAL_CLIENT_EMAIL   # client_email
   npx wrangler secret put GCAL_PRIVATE_KEY    # private_key, newlines included
   ```
3. In Google Calendar, create a calendar and share it with the service account's
   email address, giving it "Make changes to events".
4. Paste that calendar's ID into Kanryo's settings page.

A due date now shows up on that calendar within seconds. With a time it becomes a
30 minute event, without one it is all day. Completing or deleting the task removes
it again.

## Using it with Claude

The worker serves MCP at `/mcp/<KANRYO_TOKEN>` with tools for listing, creating and
updating projects and tasks, filing inbox items, tagging, and viewing attachments.

In claude.ai, go to Settings, then Connectors, and add a custom connector pointing
at:

```
https://<your-worker>.workers.dev/mcp/<KANRYO_TOKEN>
```

The token in the path is what authenticates the call, so treat that whole URL like
a password.

Tools alone are not enough. [`skill/SKILL.md`](skill/SKILL.md) is the skill that
tells Claude how to behave: close a task the moment you say you finished it, but ask
before creating or deleting anything, and read a project in brief mode before
pulling whole notes into the conversation. Replace the placeholder URL inside it,
zip the file in a folder called `kanryo`, and upload it under Settings, Capabilities,
Skills. Claude Code picks it up from `~/.claude/skills/kanryo/` instead.

Then a chat can handle things like "what is on my review list for the recipe app"
or "we finished the offline mode, mark it done".

![Completed projects](docs/screenshots/completed-projects.png)

## Some decisions, in case they look like gaps

Single user is structural, not an oversight. One shared password, one bearer token.
Accounts would mean a user table, sessions and per-row ownership for no benefit here.

There are no recurring tasks. A habit belongs in a habit tracker, not a project
board. There are also no push notifications, because Google Calendar already does
reminders well.

Calendar sync writes its failure state first. Any change that affects an event marks
the task dirty in the same database write, then converges in the background. If the
worker dies mid-sync the flag is still set and the next app load retries it. Deleted
tasks leave a tombstone so their event can still be removed afterwards.


## Development

```bash
npm run dev        # vite plus worker against a local D1
npm test           # vitest
npm run check      # typecheck
```

The dev server uses a local database, so you can seed whatever you like without
touching your real board.

## License

MIT, see [LICENSE](LICENSE).
