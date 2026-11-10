# Task Board sample parity — 2026-11-10

Branch `feat/task-board-project-views`, exact base
`bf0759cf8f5d2af29929f66e803bb8975ce0f6be`, stacked on
[samples #8](https://github.com/ato-run/ato-samples/pull/8).
UI-only commit: `6553463`. No deployment or production adoption.

The common UI plus `profiles/projects-v2` files (21 files) match the API feature
branch byte for byte. v2 wrapper SHA-256:
`5feb27f881af4a656cb6dc15295797b3e8c084ee819cf5f1e8cb924a129b55b6`.
The existing sample v1 handler, operation declaration and data port remain
byte-identical to this base. The sample's pre-existing due-date projection is
retained; copying the API UI does not replace that immutable v1 closure.

Both `current` and `projects-v2` standalone packages build with the standard Node
scripts. JavaScript syntax and `git diff --check` pass. The API checkout verifies
the common UI and identical v2 closure using 35 unit/contract tests and the real
local Operation Bridge / D1 / Wasm / Chromium acceptance, including 24 layout/theme
captures. That is local acceptance; no deployed sample or v2 Calendar reconsent
is claimed.

Full evidence and release boundaries:
[API worklog](https://github.com/ato-run/ato-api/blob/feat/task-board-project-views/docs/ops/task-board-project-views-2026-11-10.md)
and [draft contract](https://github.com/ato-run/ato-api/blob/feat/task-board-project-views/docs/rfcs/draft/task-board-project-views.md).
A comprehensive writer fence/coordinator must be implemented and reviewed before
live migration; registry verification, explicit approval and Calendar consent
remain separate gates. `todo.board@2` is only a local candidate name.


Follow-up: view navigation, selected-view indication, task count and sync status
now live only in the sidebar. Duplicate main page titles and view tabs were removed
at the user's request. The common UI startup sync label is fixed. The 21 common
UI/Project files still match the API branch. Production UI adoption uses an API-only
legacy compatibility profile and is recorded in its separate production worklog;
this sample remains the DataResource profile and is not adopted automatically.
