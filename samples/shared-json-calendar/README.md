# shared-json-calendar

A calendar built from a **projection**, not from someone else's document. It
owns nothing: it invokes one declared observation against the Port the owner
connected, and arranges the due dates that come back.

The root `capsule.toml` is the `ato.capsule/1` route consumed by Formation.
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
