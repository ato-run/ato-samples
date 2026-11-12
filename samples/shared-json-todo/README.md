# shared-json-todo

A task board whose board document is **its own**, kept in a Data Resource the
account owns — so a second app can consume exactly the projection it was
granted. This is the writing half of the pair; `shared-json-calendar` is the
operation-only reading half.

The root `capsule.toml` is `ato.capsule/2` authoring: one Static Web derivation whose Contract requires `GET /` → 200. `ato pack` compiles it into a portable Application bundle.
`fixtures/legacy-store-capsule.toml` preserves the former Store submission
grammar as a negative Formation fixture; it must fail with
`legacy_store_manifest` rather than falling back to a Preset.

## What it declares

`ato.data.toml` (the owner's document Port):

```toml
schema = "ato.data-ports/1"

[[port]]
name = "tasks"
protocol = "todo.board@1"
scope = "user"
access = "read_write"
required = true
```

`ato.operations.yaml` declares the board's operations against that Port with
`schema: ato.operations/v2` and `state.kind: data_port`. The App's UI calls
those operations (list, create, update, move, delete, …); the board document is
the only state, and every commit is applied on the revision just read.

The operation **`todo_list_due_dates`** is the only one a calendar needs: it
reads the document inside the trusted handler and returns just
`task_id`, `title`, `due_at`, `completed` for tasks that have a due date.
Descriptions, subtasks, columns and recurrences never leave the handler.

The second projection is **`todo_list_shared`**: the owner marks a task as
shared with `todo_set_shared`, and this operation returns only those tasks,
limited to `task_id`, `number`, `title`, `status` and `due_at`.

## Choosing which board this app uses

The board header shows the DataResource this instance is bound to. Clicking it
lists the boards the person may use — the current board, their personal boards,
team boards, any other accessible `todo.board@1` Resource — plus **Create a new
board**. Picking one is an explicit user action that becomes a Binding; the
platform never chooses a Resource for the app, and the app never reads one it
was not granted.

The UI talks to the app-facing Resource bridge (same origin, instance scoped)
and nothing else:

| Call | Used for |
| --- | --- |
| `GET /__ato/data-ports` | the declared port `tasks` and its current binding |
| `GET /__ato/data-ports/tasks/candidates?access=read` | the boards to offer |
| `POST /__ato/data-ports/tasks/connect` | binding `{ resource_id, expected_epoch, access }` |
| `POST /__ato/data-resources` | creating a board `{ display_name, document }` |

Behaviour:

- **Bound**: the app reads the board through its own operations
  (`todo_board` / `todo_list`). Nothing else changes.
- **Not bound**: the chooser opens by itself. No candidates offers create
  instead; a single candidate is still confirmed by hand, so the first binding
  is never implicit.
- **First read fails**: the board area shows an error with a retry, never an
  empty board — "no tasks" and "could not read" are different states.
- **Remembered board**: the last selection is kept in `localStorage` under
  `ato.task-board.resource.v1` as a UI hint only. Every start re-reads
  `GET /__ato/data-ports`; when the binding is gone the chooser opens and the
  hint is only used to say which board is no longer available.
- **Read-only grant**: when the binding is read-only the app says so and refuses
  edits locally; the server still enforces it.

The grouping uses the `owner_kind` of each candidate (`user`/`personal` →
personal, `team`/`organization` → team, anything else → other). A Resource the
candidates list does not include (internal listing, personal slot) is added from
the current binding so the active board is always visible.

### Tests

```sh
cd samples/shared-json-todo
node --check resource-switcher-core.js
node --check resource-switcher.js
node --check operation-client.js
node --check app-1.js
node --test "tests/*.test.mjs"
```

The tests are DOM-free: `resource-switcher-core.js` holds the bridge client and
the selection rules, and is evaluated in a Node `vm` sandbox against a stub
`fetch` (no browser, no dependency install).

## Team sharing (selected tasks only)

A task carries a `shared` flag that the owner toggles with `todo_set_shared`.
`todo_list_shared` returns only the shared tasks, and only
`task_id`, `number`, `title`, `status` and `due_at`. Everything else
(description, subtasks, comments, private tasks) never crosses the Port.

Sharing is a Grant to one instance, not a property of the data: the owner
connects the member's Task Board with an operations-only Port that lists
`todo_list_shared`. That instance cannot read the document, cannot invoke
another operation, and loses the shared view the moment the owner unshares —
the board, its tasks and its revision stay.

## What is shared, and what is not

- The Resource document is the authoritative board. There is no local copy to
  drift; the browser's localStorage is only a fallback when no Resource is
  connected.
- A second app becomes possible because the shape is written down
  (`schema.jsonc`, and the description saved beside the data), not because the
  platform imposed a type.
- Consumer apps get operations, not the document. A document read through an
  operation-only Port is refused by the runtime, and an operation that the Port
  does not list or the owner's grant does not include is refused as well.

## Running it

The app uses the runtime's data-ports bridge and instance-operations bridge
(`window.atoDataPorts` / `window.atoInstanceOperations`), so it runs against the
hosted runtime and the self-host Coordinator without a document-read bridge.
Static Web serving is declared by `capsule.toml`; `ato pack`/`ato run` validate
that route, and data access is admitted separately when a Resource is connected
and the Port grant is approved.
