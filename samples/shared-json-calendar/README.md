# shared-json-calendar

A calendar built by **reading someone else's JSON**, not by defining a type. It
owns nothing: it opens the same port `shared-json-todo` does, reads the one
Resource the person connected, and arranges what is already there by due date.
Delete a task in Todo and it is simply not here — there is no calendar copy to
go stale.

The root `capsule.toml` is the `ato.capsule/1` route consumed by Formation.
`fixtures/legacy-store-capsule.toml` preserves the former Store submission
grammar as a negative Formation fixture; it must fail with
`legacy_store_manifest` rather than falling back to a Preset.

## What it declares

```toml
[[port]]
name = "todo"
protocol = "ato.data.json@1"
scope = "user"
access = "read"
required = true
```

`access = "read"` is enforced by the runtime, not by this app's restraint: a
write through this port is refused server-side. That boundary is worth proving,
but not by having a read-only app attempt a write on every launch — the check
lives in the browser E2E, which asks once, deliberately, from a known-good
session.

## How it knows what to read

From the **description** the owner saved beside the data (and from Todo's
source). Nothing was standardised for it: `tasks` keyed by id, `dueAt` as a
plain `YYYY-MM-DD`, `completed` independent of `columnId`. The app shows that
description under *How this data is organised*, as plain text — it is prose, so
it is never rendered as markup and nothing in it is followed.

That is the whole idea being demonstrated. A second app became possible because
the shape is **written down**, not because the platform imposed one.

Two consequences the code takes seriously:

- **`dueAt` is a date, not an instant.** It is used as the day directly. No
  time and no timezone is invented for it, because converting it is exactly how
  a date slips to the 19th or the 21st for somebody.
- **Same protocol is not same meaning.** A document this app was not written
  for is reported as unsupported, never rendered as an empty month. The data is
  still stored, unchanged.

`completed` decides whether an entry reads as done. The column is shown beside
it as a separate fact — this app does not reconcile the two, because on this
board they are genuinely independent.

When access is revoked or the signed-in account changes, the calendar and the
description are cleared rather than left on screen.

## Updating without polling

It subscribes to the Resource and re-reads under its own authority when a
revision lands. The notification carries no document body, and a duplicated or
out-of-order one cannot move the view backwards.

## Running it

Same as its Todo half: it needs `window.ato.data`, so it runs on ato.run. Add
it as an app and connect its `todo` port to the **same** data Todo uses. That
adds a Binding and copies nothing, so the data is still charged once.

No `health.toml`, for the same reason.
