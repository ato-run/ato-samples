# Task Board multi-DataResource P0 (2026-11-12)

Status: investigation complete. No production resource was touched.

## Working instance

| Field | Value |
| --- | --- |
| Instance | `cinst_01M72JS752NMD7VC5GA70MHB0W` |
| Compute | `cmp_508b80d4cecba818557e6ea38fbe125dc7da98aea01f949b65e2409454bd319b` |
| Schema | `csch_01M72JS2H8DNQFE1MTYPRVNG0H` |
| Host | `cinst-jmwhj35fooytnvj3.app.ato.run` |
| Source | `local_upload`, static materialization `sha256:85e67f43754316ab1b7f960c3074b330e42f7f1f3706d71ebb6a04eff9e6853f`, app repo `ato-samples` branch `feat/task-board-project-views` |

A second instance `cinst_01M72VYMJ5HMZA7A10BV1RTVFK` was created later but only has a
revoked `team_tasks` binding and no `tasks` binding. It is not the working board.

## Ports and operations

Schema `csch_01M72JS2H8DNQFE1MTYPRVNG0H` declares two operation-only ports:

| Port | Scope | Protocol | Access | Required |
| --- | --- | --- | --- | --- |
| `tasks` | user | `todo.board@1` | read_write | yes |
| `team_tasks` | instance | `todo.board@1` | read_write | no |

`tasks`: `todo_list, todo_get, todo_get_by_number, todo_create, todo_update,
todo_initialize, todo_move, todo_delete, todo_archive_done, todo_reset,
todo_replace_board, todo_board, todo_list_due_dates`.

`team_tasks`: the same 13 operations with the `todo_team_` prefix.

## Bindings and data

| Port | Resource | Binding | Revision | Tasks |
| --- | --- | --- | --- | --- |
| `tasks` | `dres_fcdc8d9b18ba48e6813dd4d371e5418f` | `dbind_25d7cb76e8704c39acfb22a5fed00135` active | 3 | 3 |
| `team_tasks` | `dres_1e63524709dc4904a741362f5cb86158` | `dbind_c586e5a083414ca6b27f23734a532333` active | 12 | 7 |

Both resources are `backend_kind=document`, `protocol_ref=todo.board@1`, and store
the board as `data_document_revisions.document_json`. The app's localStorage is a
presentation cache and broadcast channel; the DataResource head is the authority.
The schema write policy is `operations_only`.

## Backup and restore

Backup taken before any change:

- `.tmp/taskboard-p0-backup/dres_fcdc8d9b18ba48e6813dd4d371e5418f.json`
  revision 3, digest `sha256:18b80db6da359174d6aa611b968dae679b63d12225d19526b1f94943f56d4fb6`
- `.tmp/taskboard-p0-backup/dres_1e63524709dc4904a741362f5cb86158.json`
  revision 12, digest `sha256:345371594e9aacb4902de9f4adec5f96a80d9a61d3499ad4e8b8299fb22e0a30`

The exported bytes match both content digests. Restore is append-only:

1. Insert a new `data_document_revisions` row with the backup JSON and `revision = head + 1`.
2. Update `data_document_heads.head_revision_id` and `generation` to that row.
3. Confirm the new head digest equals the backup digest.
4. Never edit or delete an existing revision.

## Current Personal / Team / All implementation

- `index.html` has a `boardSelect` with `tasks`, `team_tasks`, `all`.
- `operation-client.js` maps `team_tasks` to the `todo_team_` operation prefix.
- `all` reads both boards and merges them with `board:taskId` ids, then sets
  `window.__atoBoardReadOnly = true`, so every edit is refused.
- `workspace-ui.js` binds the `tasks` port by default and the team port only when
  the instance has an `instance_data_bindings` row.

## Gaps for the multi-Resource work

1. The schema has no `shared_tasks` user-scope port. PR1 adds it with
   `todo_shared_*` operations.
2. The app has no resource selection, creation, or grant flow. The platform
   already exposes candidate list, connect, and grant endpoints in
   `dataResourcesClient`; the app needs a first-party request/approval bridge.
3. `all` is read-only. PR3 must route each edit by the task's port.
4. There is no per-port subscription; PR4 adds per-resource observation and
   revocation handling.

## Planned PRs

1. `feat/task-board-shared-port`: `shared_tasks` port and `todo_shared_*`
   operation declarations. App logic unchanged.
2. `feat/task-board-connect-ui`: app-initiated connect request plus PWA
   approval using the existing candidates/connect/grant APIs.
3. `feat/task-board-merged-edit`: merged display with `(resourceId, taskId)`
   identity and writes routed by port.
4. `feat/task-board-sync-e2e`: per-resource sync, revocation, and the staging
   two-user E2E.

## Safety

- Production is out of scope.
- The existing instance and both resources are unchanged.
- The newer duplicate instance is left untouched.
- Backups live outside the app source tree in `.tmp/taskboard-p0-backup/`.
