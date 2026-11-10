# shared-json-todo

A TODO app whose board is a DataResource, not browser storage. The app declares
what it needs (`ato.data.toml`) and the operations it offers
(`ato.operations.yaml`); the person who runs it chooses which Resource is the
authority.

## Contract

- `ato.data.toml`: one port `tasks` with protocol `todo.board@1`, scope
  `user`, access `read_write`. The port names the app's need; it does not name
  a shared data type.
- `ato.operations.yaml` (`ato.operations/v2`): the board is read through the
  `todo_board` observation and changed through evolution operations
  (`todo_create`, `todo_update`, `todo_move`, `todo_delete`,
  `todo_archive_done`, `todo_initialize`, `todo_reset`,
  `todo_replace_board`). `todo_list`, `todo_get` and
  `todo_get_by_number` are observations. `todo_list_due_dates` is the
  projection Calendar is allowed to read.
- `src/operations/todo.js` is the trusted handler module. It receives the
  current document and returns the next one; it never talks to storage.
- The UI (`app-*.js`, `operation-client.js`) calls operations through the
  runtime bridge and renders the committed state. It does not keep a second
  copy of the board.

## What the runtime enforces

- The caller's authority is checked before the handler runs: account MCP level,
  connection capability, the Binding, the Port's required operations and the
  active Grant chain.
- A write commits with `expected_revision` and an `operation_id`; a lost
  response replays the stored result instead of running the handler twice.
- An operations-only Grant cannot read or replace the document directly, and a
  revoked Grant is refused on every entry point.

## Verification

The common UI and byte-identical v2 Project closure are exercised by the ato-api
instance-operation-bridge harness (real Worker, D1, Wasm QuickJS executor and
Chromium). The sample's existing v1 handler/catalog includes its due-date operation
and remains unchanged; it intentionally differs from the API's v1 fixture.
Staging E2E with the deployed API is tracked separately; this sample does not claim it.

## Task Board views and Project candidate

Kanban, Tickets and Roadmap share one observation and the existing Operation
bridge. Filters, sort/group, zoom and display preferences never modify the
Resource. The shared UI is vanilla JavaScript; touch/native DnD, archive,
subtasks and recurrence controls remain available. Project persistence is a
separate, unregistered `profiles/projects-v2` candidate, not an in-place change
to `todo.board@1`. The v1 handler/declaration in this sample stays unchanged.

Build from this repository root:

```sh
node scripts/build-todo-profile.mjs --profile current --out .tmp/todo-current
node scripts/build-todo-profile.mjs --profile projects-v2 --out .tmp/todo-projects
```

The new profile uses an immutable v1 implementation copy plus a v2 wrapper;
its closure matches the API implementation candidate. Only the original five
MCP operations are exposed by default. Calendar's approved due-date projection
remains task_id/title/due_at/completed; new bindings require explicit consent.

Live migration, writer fencing, registry verification, staging deployment and
production adoption are separate gates. See the [implementation contract](https://github.com/ato-run/ato-api/blob/feat/task-board-project-views/docs/rfcs/draft/task-board-project-views.md).
The preview command is read-only and performs no copy, bind, grant or deletion.
