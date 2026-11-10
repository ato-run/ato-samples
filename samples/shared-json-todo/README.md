# shared-json-todo

A task board whose board document is **its own**, kept in a Data Resource the
account owns — so a second app can consume exactly the projection it was
granted. This is the writing half of the pair; `shared-json-calendar` is the
operation-only reading half.

The root `capsule.toml` is the `ato.capsule/1` route consumed by Formation.
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
