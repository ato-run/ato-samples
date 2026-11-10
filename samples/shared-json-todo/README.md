# shared-json-todo

A task board whose JSON is **its own**, kept in a Data Resource the account
owns — so a second app can read the very same document.

This is the writing half of the pair; `shared-json-calendar` is the reading
half.

The root `capsule.toml` is `ato.capsule/2` authoring: one Static Web derivation whose Contract requires `GET /` → 200. `ato pack` compiles it into a portable Application bundle.
`fixtures/legacy-store-capsule.toml` preserves the former Store submission
grammar as a negative Formation fixture; it must fail with
`legacy_store_manifest` rather than falling back to a Preset.

## What it declares

`ato.data.toml`:

```toml
[[port]]
name = "todo"
protocol = "ato.data.json@1"
scope = "user"
access = "read_write"
required = true
```

`todo` is this app's own name for the connection, not a shared data type.
`ato.data.json@1` says only **"this is JSON"** — ato.run does not know what the
document means, and there is no standard task type anywhere in this picture.
Which concrete Resource satisfies the port is decided at runtime, by the
person, through consent.

## The shape

The document is the board shape the existing TODO already uses
(`ato.task-board.state.v1`): `columns`, and `tasks` as an **object keyed by
task id**, each task carrying a title, description, priority, subtasks, order,
column, and a `completed` flag that is **allowed to disagree with its column**.

`schema.jsonc` in this folder is the draft to paste into the data's *Data
structure description* in Settings > Data. That text is what lets somebody
update another app to read this data. Ato stores it and shows it; it never
parses it and never checks the data against it.

## How it writes

Every change is applied **on top of the document it just read**, and committed
against that revision:

```js
const snapshot = await port.read();
const next = apply(snapshot.document);   // patch, never rebuild
await port.mutate({ kind: "replace", value: next }, { expected: snapshot });
```

Four rules follow from that, and they are why this app is worth reading:

1. **Never rebuild from the fields this app knows.** Merges go through
   `merge()`, which copies whatever is there, so a field written by a newer
   version of this app — or by a different app — survives a write from this
   one. `merge()` uses `Object.fromEntries` rather than `Object.assign`
   because that one DEFINES properties instead of assigning them; assigning a
   key named `__proto__` hits the inherited setter and loses it. (ato.run
   refuses `__proto__`, `constructor` and `prototype` as document keys, so that
   exact key cannot reach a stored document — the habit is kept because the
   general rule is what matters.)
2. **Never treat an error as empty.** "Not connected", "failed to read" and
   "unexpected shape" all stop, visibly. Empty data offers *Start a new board*
   and waits to be asked: connecting an existing Resource that happens to be
   `{}` must not be indistinguishable from creating one.
3. **Never lose an edit to an unfinished save.** The compose fields clear only
   once the write is durable, and a response that never arrived is retried as
   the **same** operation rather than reissued — so a lost reply cannot apply
   twice, and the next edit waits for that outcome.
4. **Never render backwards.** A snapshot arriving mid-save is kept and applied
   afterwards, so the view converges on the newest revision instead of
   dropping whatever landed at an inconvenient moment.

A concurrent change makes a commit lose with a conflict, and the app re-reads
and re-applies. Last-writer-wins would quietly delete the other writer's work.

When access is revoked or the signed-in account changes, the board, the compose
form and the edit state are cleared, and a late-finishing save does not
re-enable editing behind that.

## Running it

It needs the runtime that provides `window.ato.data`, so it runs on ato.run
rather than from a local file. Add it as an app, then connect its `todo` port
(Connect → **Create new data** the first time, since nothing compatible exists
yet). Opened without that runtime it says so instead of pretending to save.

No `health.toml`: every meaningful behaviour needs a signed-in account and a
connected Resource, which the sample CI matrix cannot provide. The cross-app
behaviour is covered by the browser E2E in `ato-pwa` and by the Data Resource
suites in `ato-api`.
