---
name: kanryo
description: "Read and update the user's Kanryo board (YOUR-WORKER.workers.dev). Use whenever work in this session touches a tracked project - finishing, starting, dropping, rescheduling or reprioritizing something (\"done with the gap report\", \"that's finished\", \"I'll do X next\", \"add a task for Y\", \"move that to todo\", \"put that in review\", \"park that one\", \"push that to Friday\", \"what's left on this\", \"update kanryo\") - when a conversation produces a project-worthy idea or new tasks, links or artifacts for a tracked project, or on any explicit request to add, check or change something in Kanryo. Also use at the natural end of a work session to reconcile the board with what actually happened, and when the user asks to sort, triage, check or empty their inbox. Not for generic to-do talk unrelated to a Kanryo project."
---

# Kanryo

Mirror what actually happens onto the Kanryo board. The user should never have
to open Kanryo just to keep it current.

## The three states

- **review** ("To review" in the app) - not committed yet. The user still wants
  to think it through, usually by talking it over with Claude. This column is
  their agenda of conversations to have, and most raw ideas start here.
- **todo** - decided, waiting to be done.
- **done** - finished.

The lifecycle is review -> (a conversation with Claude) -> todo -> (the work
happens) -> done. The status values on the wire are exactly `review`, `todo`
and `done`.

## Reaching Kanryo

Everything goes through the Kanryo MCP tools (the connector the user added in
claude.ai, or the MCP server added to Claude Code). In Claude Code the tools may
be *deferred*: present by name but without a loaded schema. Load them with one
keyword ToolSearch before concluding they are missing:

`ToolSearch { query: "kanryo project task inbox status", max_results: 20 }`

If no Kanryo tools exist in the session, say so in one line - "Kanryo isn't
connected in this session" - and stop. Do not ask for a URL or a token and do
not improvise a workaround.

The tools:

- Projects: `list_projects` (with tags and per-status counts),
  `create_project`, `set_project_tags`, `set_project_completed`, `add_links`
- Tasks: `list_tasks` (pass `brief: true` to skim), `get_task` (one task in
  full), `add_tasks` (pass `parent_id` to create subtasks), `update_task`,
  `set_task_status`, `delete_tasks`
- Inbox: `list_inbox`, `add_inbox_item`, `file_inbox_item`
- Files: `list_task_attachments`, `list_project_files`, `view_attachment`
  (images come back as images, PDFs and Office files as text, scanned PDFs as
  page images; long documents in parts)
- Reddit (only if the user set it up): `list_reddit_saved`,
  `get_reddit_saved`, `import_reddit_saved`

Projects carry free-form tags. Projects sharing a tag are related: when working
on one, its tag siblings are where overlapping work, reusable pieces or
conflicting plans live. Reuse existing tag spellings rather than inventing
synonyms.

## Step 1 - resolve the project (once per session)

If a project id is stated in the repo's CLAUDE.md or by the user, use it.
Otherwise call `list_projects` and infer the match from the strongest signal:
repo or directory name, the subject of the conversation, the files in play.

- **One plausible match** -> state it in one line and proceed:
  `Kanryo: Recipe App (#7).` No confirmation request.
- **Two or more** -> ask once, naming them: `Recipe App (#7) or Meal Planner
  (#12)?` A wrong guess writes to the wrong board.
- **No match** -> say so and ask whether to create a project or drop the item
  in the inbox.

Hold the resolved project for the rest of the session.

**Pull the board before the first answer** when the opening message already
makes clear which project is in play: call `list_tasks` with `brief: true`
BEFORE answering, so the first answer builds on existing tasks and decisions.
Orient from titles and each note's first line; fetch a full note with
`get_task` only for the task the session is actually about.

## Step 2 - write, per this posture

**Act without asking, then report** - these only touch tasks that already
exist:

- `set_task_status` - any move between review, todo and done
- `update_task` - title, notes, priority, due date/time
- `file_inbox_item` - moving an inbox item onto a project

Asking permission to close a task the user just said they finished is exactly
the friction this skill exists to remove.

**Ask first** - these create or destroy:

- `add_tasks` - quote the exact titles you propose, one line, then wait
- `create_project` - except during inbox triage, which creates projects on its
  own
- `add_inbox_item`, `add_links`, `import_reddit_saved`
- `set_project_completed` - check `list_tasks` first and mention any tasks
  still open when you offer
- `delete_tasks` - always confirm, quoting titles. Finished work goes to done,
  never deleted. Deleting a task takes its subtasks with it.

Before adding anything, check `list_tasks` for a near-duplicate. If one exists,
sharpen it with `update_task` instead of creating a second.

New tasks default to review. Pass `todo` only for work actually decided on in
this conversation. Only set a due_date if a real date was discussed - it
creates a Google Calendar event (when calendar sync is set up), and marking the
task done removes it again.

**Notes convention.** Every note you write starts with ONE line
`Status: ...` saying where the thing currently stands, in plain language. All
detail goes below it. When updating a note, rewrite that first line to match
the new state. This is what lets a later session orient from title plus first
line without reading whole notes. In the rest of the note:

- Exact numbers and names, not adjectives: "47/51 tests pass", "commit
  6b7e291", "3 of 8 items" - not "most pass" or "nearly done".
- Say whether a decision was made by the user, agreed to by the user, or only
  proposed and never confirmed.
- For repo work, name the commit or branch, and call uncommitted work that.
- Classify what is left: blocked (on what), ready, or needs investigation (and
  what was already ruled out).
- Keep notes short: update facts in place instead of appending history.

## Step 3 - report

One line per write, after the fact. No preamble, no summary paragraph.

`-> done: write normalize.py | todo: write build.py`

If nothing needed changing, say nothing.

## Inbox triage

The inbox is where raw captures land with no project. The user does not want to
sort it by hand, so triage runs on its own, including creating projects.

**When:** on request ("triage my inbox", "sort my inbox"), and once at the
natural end of a session where this skill was already active. Never at session
start, never twice in one session.

**Procedure:**

1. `list_inbox`. Empty -> say nothing and stop.
2. `list_projects` for candidate targets.
3. Group items first. Two or more sharing a theme are decided together, so
   they can share one new project instead of spawning several.
4. Decide each item or group:
   - **File into an existing project** when the item names that project's
     subject or plainly belongs beside its tasks -> `file_inbox_item`.
   - **Create a project** when the item is a distinct deliverable with more
     than one step, or two or more items share a theme -> `create_project`
     with no seeded tasks, then `file_inbox_item` for each member.
   - **Leave it in the inbox** when it carries no action or fits two projects
     equally well. Name it in the report.
5. Report in one line:

`-> filed: colour picker -> Kanryo | 3 notes -> new project "Reading list" | left: "check that podcast" (ambiguous)`

When in doubt, leave it: an item waiting one more round beats a wrong guess on
a real board. Never delete during triage. Filed items keep their review status.

## Proactive offers

Offer (asking first, one short question) when:

- a conversation produced a project-worthy idea -> `create_project`, optionally
  with tasks and links (repo remote, live URL, docs)
- a review item was talked through and the user decided to go ahead -> promote
  it to todo and add the concrete steps that came out of it; if they decided
  against it, offer to close it
- something is worth keeping but not project-worthy -> `add_inbox_item`

Do not file trivia. Never invent due dates. Never re-offer something the user
declined in this session.

## Counter-example

> **User:** I should really start meal prepping on Sundays

No project is in play and this is a passing thought, not progress on tracked
work. Do nothing. If the user later says it is worth keeping, `add_inbox_item`,
after asking.
