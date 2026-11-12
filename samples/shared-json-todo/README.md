# shared-json-todo

A task board with a personal DataResource and an optional shared DataResource.
Each member connects their own personal board. Members who have a grant to the
same shared board can edit it together.

The root `capsule.toml` is `ato.capsule/2` authoring: one Static Web derivation whose Contract requires `GET /` → 200. `ato pack` compiles it into a portable Application bundle.
`fixtures/legacy-store-capsule.toml` preserves the former Store submission
grammar as a negative Formation fixture; it must fail with
`legacy_store_manifest` rather than falling back to a Preset.

## What it declares

`ato.data.toml` declares two user-scope operation Ports for `todo.board@1`.

| Port | Board | Operations |
| --- | --- | --- |
| `tasks` | Personal (required) | `todo_*`, including the existing projections |
| `shared_tasks` | Shared (optional) | The 13 `todo_shared_*` board operations |

The UI routes reads and edits to the selected Port. Both use
`ato.operations/v2` and commit against the DataResource revision read by the
server. An update sends the board-local task ID and an ISO timestamp in `at`.

The operation **`todo_list_due_dates`** is the only one a calendar needs: it
reads the document inside the trusted handler and returns just
`task_id`, `title`, `due_at`, `completed` for tasks that have a due date.
Descriptions, subtasks, columns and recurrences never leave the handler.

The second projection is **`todo_list_shared`**: the owner marks a task as
shared with `todo_set_shared`, and this operation returns only those tasks,
limited to `task_id`, `number`, `title`, `status` and `due_at`.

## Choosing which board this app uses

Choose Personal or Shared, then use the board name to open the existing
DataResource chooser for that Port. The owner can create a separate board for
Shared. For each collaborator, the owner grants `read`, `write`, and `connect`
with the shared Port's Operation allowlist. Each collaborator connects that
Resource under Shared. The personal binding remains independent.

The UI talks to the app-facing Resource bridge (same origin, instance scoped)
and nothing else:

| Call | Used for |
| --- | --- |
| `GET /__ato/data-ports` | the two declared Ports and their current bindings |
| `GET /__ato/data-ports/:port/candidates?access=read` | the boards to offer for the selected Port |
| `POST /__ato/data-ports/:port/connect` | binding `{ resource_id, expected_epoch, access }` |
| `POST /__ato/data-resources` | creating a board `{ display_name, document }` |

Behaviour:

- **Bound**: the app reads the selected board through `todo_board` or
  `todo_shared_board`. The Shared view checks for changes while visible.
- **Unbound Personal**: the chooser opens on startup. Select a Resource or
  create a board to connect it.
- **Unbound or revoked Shared**: the view clears the previous board. Open
  the chooser to connect a Resource for which you have an active grant.
- **First read fails**: the board area shows an error with a retry, never an
  empty board — "no tasks" and "could not read" are different states.
- **Remembered personal board**: the last Personal selection is kept in `localStorage` under
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

## Selected-task projection

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

- In a hosted Instance, each board is loaded from its connected DataResource.
  The board is cleared when changing Ports or losing access.
- A second app becomes possible because the shape is written down
  (`schema.jsonc`, and the description saved beside the data), not because the
  platform imposed a type.
- Consumer apps get operations, not the document. A document read through an
  operation-only Port is refused by the runtime, and an operation that the Port
  does not list or the owner's grant does not include is refused as well.

## Running it

The app uses the runtime's Data Port endpoints and instance-operations bridge
(`window.atoInstanceOperations`).
Static Web serving is declared by `capsule.toml`; `ato pack`/`ato run` validate
that route, and data access is admitted separately when a Resource is connected
and the Port grant is approved.
