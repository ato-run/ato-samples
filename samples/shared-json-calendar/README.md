# shared-json-calendar

A calendar built from a **projection**, not from someone else's document. It
owns nothing: it invokes one declared observation against the Port the owner
connected, and arranges the due dates that come back. The person chooses which
board it reads, in the app, once.

The root `capsule.toml` is `ato.capsule/2` authoring: one Static Web derivation whose Contract requires `GET /` → 200. `ato pack` compiles it into a portable Application bundle.
`fixtures/legacy-store-capsule.toml` preserves the former Store submission
grammar as a negative Formation fixture; it must fail with
`legacy_store_manifest` rather than falling back to a Preset.

## What it declares

```toml
schema = "ato.data-ports/2"

[[port]]
name = "tasks"
protocol = "todo.board@1"
scope = "user"
access = "operations"
operations = ["todo_list_due_dates"]
required = true
```

This is an **operation-only** Port. The calendar cannot read the board
document, and the runtime enforces it: a document read is refused even if this
App tried one. The operation must also appear in the owner's effective grant;
the intersection of "Port lists it" and "owner granted it" is required.

The operation returns only `task_id`, `title`, `due_at` and `completed`. The app
shows the due date as a plain calendar date, never as an instant, and never
claims a task's description or columns because it never receives them.

## How it knows what to read

The projection is the contract, written down in the TODO sample's
`ato.operations.yaml`. Nothing about the board document is standardised for this
app; if the projection is missing, the app stops visibly rather than rendering
an empty month.

Which Resource the Port points at is never automatic. The platform does not pick
a board for the app, so the app asks the person, in the header:

| Call | Used for |
| --- | --- |
| `GET /__ato/data-ports` | this Port's declaration and its current binding |
| `GET /__ato/data-ports/tasks/candidates?access=read` | the boards the person may choose |
| `POST /__ato/data-ports/tasks/connect` | binding `{ resource_id, expected_epoch, access: "read", operations: ["todo_list_due_dates"] }` |
| `DELETE /__ato/data-ports/tasks/connection` | removing the binding |

Behaviour:

- **Not connected**: the header says it is not connected yet and offers a
  button. Opening it lists the candidates the platform returns for this Port,
  grouped like Task Board — 自分のボード (personal Resources) and チームのボード
  (organization boards the person is a current member of), plus 現在のボード /
  その他のボード when they apply. Nothing is selected for the person.
- **Choosing a board**: one explicit click sends the connect call with the
  operation-only access the Port allows. The declarations are read back to learn
  the binding the server actually made, and the events reload in place — no page
  reload.
- **Connected**: the header shows the board's display name. The same control
  lists the candidates again to switch, and 接続を解除 disconnects the Port.
- **Access changed** (revoked, another actor): the projection is cleared
  immediately, the declarations are re-read, and the chooser is offered again
  with the failure named in Japanese. A failed read is never rendered as an
  empty month.

The bridge client and candidate/chooser rules are `resource-switcher-core.js`,
copied unchanged from Task Board. `calendar-core.js` is the DOM-free half that
decides Calendar's state (startup, connect, disconnect, messages) and
`calendar-switcher.js` renders it; `app.js` reads and draws the events only while
the switcher says the Port is bound.

### Tests

```sh
cd samples/shared-json-calendar
node --check resource-switcher-core.js
node --check calendar-core.js
node --check calendar-switcher.js
node --check app.js
node --test "tests/*.test.mjs"
```

The tests are DOM-free: `resource-switcher-core.js` and `calendar-core.js` are
evaluated in a Node `vm` sandbox against stub `fetch` and callbacks (no browser,
no dependency install). They cover the startup decision (unbound → chooser
prompt, bound → the events are read), the connect call's exact body, the stale
epoch retry, and disconnect.

## Library icon

`icon.png` (512×512) is this app's icon in the Library, rendered from
`icon.svg`. A capsule does not carry its icon yet, so set it once after
installing. On a self-hosted Ato:

```sh
selfhost set-app-icon COMPUTE_ID --icon - < icon.png
```
