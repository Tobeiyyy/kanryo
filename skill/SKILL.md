---
name: kanryo
description: "Read and update the user's Kanryo board (YOUR-WORKER.workers.dev). Use whenever work in this session touches a tracked project - finishing, starting, dropping, rescheduling or reprioritizing something (\"done with the gap report\", \"that's finished\", \"I'll do X next\", \"add a task for Y\", \"move that to todo\", \"put that in review\", \"park that one\", \"push that to Friday\", \"what's left on this\", \"update kanryo\") - when a conversation produces a project-worthy idea or new tasks, links or artifacts for a tracked project, or on any explicit request to add, check or change something in Kanryo. Also use at the natural end of a work session to reconcile the board with what actually happened. Not for generic to-do talk unrelated to a Kanryo project. Also use when the user asks to sort, triage, check or empty their inbox."
---

# Kanryo

Mirror what actually happens onto the Kanryo board. The user should never have
to open Kanryo to keep it current.

## The three states

- **"To review"**  - not committed; the
  user still wants to think it through, usually by talking it over with Claude.
  This column is his agenda of conversations to have, and most things he dumps
  himself start here.
- **`todo`** - decided, waiting to be done.
- **`done`** - finished.

Say "review" when talking to the user; The lifecycle is review -> (a conversation with
Claude) -> todo -> (the work happens) -> done.

## How to reach Kanryo

Prefer the MCP tools: `list_projects`, `list_tasks`, `create_project`,
`add_tasks`, `add_links`, `add_inbox_item`, `list_inbox`, `file_inbox_item`,
`update_task`, `set_task_status`, `delete_tasks`, `set_project_completed`.

In Claude Code they are namespaced `mcp__<server-id>__list_tasks` and are
usually *deferred* - present but with no schema loaded, so a direct call fails.
Load them with ONE keyword ToolSearch before concluding they are missing:

`ToolSearch { query: "kanryo project task inbox status", max_results: 15 }`

Use keyword search, not `select:` - the server-id prefix varies per machine and
`select:` only matches full names.

**Fallback, Claude Code only:** if no Kanryo MCP tools surface and
`%USERPROFILE%\.claude\skills\kanryo\config.json` exists (`{url, token}`), use
the REST API. Never use WebFetch - it cannot send an Authorization header. Use
the PowerShell tool:

```powershell
$cfg = Get-Content "$env:USERPROFILE\.claude\skills\kanryo\config.json" -Raw | ConvertFrom-Json
$h = @{ authorization = "Bearer $($cfg.token)" }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Invoke-RestMethod -Uri "$($cfg.url)/api/projects" -Headers $h              # id, name, per-status counts
Invoke-RestMethod -Uri "$($cfg.url)/api/projects/17" -Headers $h           # .project, .links, .tasks (full notes)
Invoke-RestMethod -Uri "$($cfg.url)/api/tasks/58" -Headers $h              # one task by id
Invoke-RestMethod -Uri "$($cfg.url)/api/inbox" -Headers $h                 # unclassified items
```

Writes: `POST /api/tasks`, `POST /api/projects`,
`POST /api/projects/{id}/links`, `PATCH /api/tasks/{id}`,
`PATCH /api/projects/{id}` with `{"completed": true}`,
`DELETE /api/tasks/{id}`. Filing an inbox item over REST is
`PATCH /api/tasks/{id}` with `{"project_id": N}`. Send bodies as UTF-8 bytes or
umlauts and dashes get mangled on the way out:

```powershell
$body = @{ title = "Chapter 2 rewrite" } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "$($cfg.url)/api/tasks/59" -Headers $h `
  -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

Shape gotchas: counts from `/api/projects` cover top-level tasks only, while
`.tasks` from `/api/projects/{id}` also includes subtasks (non-null
`parent_id`); and `/api/projects/{id}` nests metadata under `.project`.

If neither the MCP tools nor the config file are available (for example a
claude.ai chat with the connector switched off), say so in one line - "Kanryo
isn't connected in this session" - and stop. Do not ask for a URL or a token,
do not improvise a workaround.

## Step 1 - resolve the project (once per session)

If a project id is declared in the repo's CLAUDE.md or stated by the user, use
it and skip the rest. Otherwise call `list_projects` and infer the match from
the strongest signal available: repo or directory name, the subject of the
conversation, the files and artifacts in play.

- **One plausible match** -> state it in one line and proceed.
  `Kanryo: Video Game Archive (#7).` No question, no confirmation request.
- **Two or more** -> ask once, naming them: `Video Game Archive (#7) or
  Github (#19)?` Project names are short and several overlap; a wrong guess
  writes to the wrong board.
- **No plausible match** -> say so and ask whether to create a project or drop
  the item in the inbox.

Hold the resolved project for the rest of the session. Re-resolve only if the
user names a different one.

**Pull the board before the first answer.** When the session's opening message
already makes clear that a tracked project is in play, resolve it and call
`list_tasks` on it BEFORE answering - not later when something needs writing.
The first answer should build on what the board already knows: existing tasks,
their notes, prior decisions. Orient from titles and each note's first line
("Stand: ..."); read a note in full only when that task is what the session is
actually about. Until Kanryo has a short mode, `list_tasks` returns every note
in full - so pull at most ONE project per session this way, the one clearly in
play. If no project is clearly in play at the start, skip this and resolve
lazily as before.

## Step 2 - write, per this posture

**Act without asking, then report** - these only touch tasks that already
exist:

- `set_task_status` - any move between `review` (review), `todo` and `done`
- `update_task` - title, notes, priority, due date/time
- `file_inbox_item` - moving an inbox item onto a project (see Inbox triage)

Asking permission to close a task the user just said he finished is exactly the
friction this skill exists to remove. Do not hedge, do not present a plan for
approval.

**Ask first** - these create or destroy:

- `add_tasks` - quote the exact titles you propose, one line, then wait
- `create_project` - **except during inbox triage**, which creates projects on
  its own
- `add_inbox_item`, `add_links`
- `set_project_completed` - check `list_tasks` first and mention any tasks
  still open when you offer
- `delete_tasks` - always confirm, quoting titles. Finished work goes to
  `done`, never deleted. Deleting a task takes its subtasks with it.

Before adding anything, call `list_tasks` and check for a near-duplicate. If
one exists, sharpen it with `update_task` instead of creating a second.

New tasks default to `review` (review). Pass `"todo"` only for work actually
decided on in this conversation. Only set a due_date if a real date was
discussed - it creates a Google Calendar event, and marking the task done
removes it again.

**Notes convention.** Every note you write or update starts with ONE line
`Stand: ...` stating where the thing currently stands, in plain language. All
detail goes below it. When updating an existing note, rewrite that first line
to match the new state - never let it go stale while details pile up
underneath. This is what lets a later session orient from title + first line
without reading whole notes.

## Step 3 - report

One line per write, after the fact. No preamble, no summary paragraph, no
restating what the user just said.

`-> done: write normalize.py | todo: write build.py`

Batch multiple writes into one line. If nothing needed changing, say nothing.

## Inbox triage

The inbox is where raw captures land with no project. The user does not want to
sort it by hand, so this runs autonomously - including creating projects, which
is the one place that overrides the "ask first" rule above.

**When:** on demand ("triage my inbox", "sort my inbox", "what's in my inbox"),
and once at the natural end of a session where this skill was already active.
Never at session start, never twice in one session.

**Procedure:**

1. `list_inbox`. Empty -> say nothing and stop.
2. `list_projects` for candidate targets.
3. Group the items first. Two or more sharing a theme are decided together so
   they can share one new project rather than spawning several.
4. Decide each item or cluster against this bar:
   - **File into an existing project** - the item names that project's subject,
     or its work plainly belongs beside that project's existing tasks.
     -> `file_inbox_item`
   - **Create a project** - the item describes a distinct deliverable implying
     more than one step, or a cluster of two-plus items shares a theme.
     -> `create_project` (name, icon, accent, description) with **no seeded
     tasks**, then `file_inbox_item` for each member. Seeding would duplicate
     the idea as a new task while the original still sat in the inbox; the
     point is to relocate the real rows.
   - **Leave it in the inbox** - the item carries no action, or it fits two
     projects equally well. Make no call and name it in the report.
5. Report one line:

`-> filed: colour picker -> Kanryo | 3 notes -> new project "Reading list" | left: "check that podcast" (ambiguous)`

**The leave-behind rule is what makes this safe.** The failure mode should be an
item waiting one more round, never a wrong guess landing on a real board. When
in doubt, leave it.

**Never delete.** Discarding an inbox item stays a human decision in the app.
Triage has no delete step.

Filed items keep their `review` status, so they land in the project's
"To review" column - correct for something that has never been discussed. Never
invent a due date during triage.

If a `file_inbox_item` call fails, report that item as left behind and carry on
with the rest. A failed triage never blocks the session.

## Proactive offers

Beyond mirroring finished work, offer (asking first, one concise question):

- a conversation produced a project-worthy idea -> `create_project`, optionally
  seeded with tasks and with links (repo remote, live URL, this chat, docs);
  in a git repo include the remote via `git remote get-url origin`, else the
  folder path
- a review item was talked through and the user decided to go ahead -> promote
  it to `todo` and add any concrete steps that came out of the discussion; if
  he decided against it, offer to delete it rather than let it rot
- something is worth keeping but not project-worthy -> `add_inbox_item`

Do not file trivia. Never invent due dates. Never re-offer something declined
in this session.

## Counter-example

> **User:** I should really start meal prepping on Sundays

No project is in play and this is a passing thought rather than progress on
tracked work. Do nothing. If he later says it is worth keeping,
`add_inbox_item` - after asking.