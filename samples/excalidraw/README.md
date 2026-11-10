# excalidraw

The real Excalidraw whiteboard (`@excalidraw/excalidraw`, pinned 0.18.1), whose
scene is a declared DataResource surface rather than browser-only state.

This is the third app of the OSS quick-start workspace (with
`shared-json-todo` and `shared-json-calendar`). It demonstrates the **state and
export** paths: the scene is read through `scene_load`, saved through
`scene_save` (Evolution), and exported through `scene_export` (Observation).
The app never receives a document bridge; it calls the runtime's
instance-operations bridge, so it works against the hosted runtime and the
self-host Coordinator alike.

## What it declares

`ato.data.toml` — the owner's document Port:

```toml
schema = "ato.data-ports/1"

[[port]]
name = "scene"
protocol = "excalidraw.scene@1"
scope = "user"
access = "read_write"
required = true
```

`ato.operations.yaml` (`ato.operations/v2`) declares three operations against
that Port (`state.kind: data_port`):

| operation | semantics | what it returns |
|---|---|---|
| `scene_load` | observation | `{ scene: { elements, appState, files } }` |
| `scene_save` | evolution | replaces the stored scene; returns element count |
| `scene_export` | observation | the same scene, for a download/handoff artifact |

The stored document is `{ schemaVersion: 1, scene }`. Handlers validate only
that `elements` is an array (and `appState`/`files` are objects when present);
Ato does not interpret the Excalidraw format.

## Build and run

Excalidraw needs a bundle build; `capsule.toml` declares it:

```sh
npm install && npm run build   # writes dist/
```

`ato run`/`ato pack` consume the built `dist/` tree through the declared static
route. The browser must have a connected scene Resource and an approved grant
for these operations; without one, the app shows a visible "not connected"
state instead of an empty canvas.

## What this proves (and does not)

- State and export are **declared operations**, not localStorage: the same
  scene can be loaded, saved and exported through the common operation surface.
- A checkpoint is an explicit "Save checkpoint" action; ordinary edits stay in
  the editor until saved, so an unfinished edit is never presented as durable.
- Multi-app workspace layout (Excalidraw beside TODO/Calendar) and the
  cross-host continuation are D2/D7/T1, not this sample.
