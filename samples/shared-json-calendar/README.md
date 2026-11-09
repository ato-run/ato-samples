# shared-json-calendar

A calendar that owns no data. It reads one projection of the TODO board the
person explicitly shared with it.

## Contract

- `ato.data.toml`: one port `tasks` with protocol `todo.board@1`, scope
  `instance`, access `operations`, `operations = ["todo_list_due_dates"]`.
  The port is operation-only: there is no document read, replace or export
  through it.
- The app calls `todo_list_due_dates` through the runtime bridge and renders
  only the declared fields: `task_id`, `title`, `due_at`, `completed`.
- No copy of the board is stored. When the share is revoked the next call is
  refused and the app shows that it cannot read the dates; the TODO board and
  its revision are untouched.

## What the runtime enforces

- The Grant chain must be operations-scoped and list `todo_list_due_dates`;
  a child Grant cannot widen it.
- Revocation is evaluated on every call, including reads of previously returned
  results.
- A failed read is shown as a failure, never as an empty calendar.

## Verification

The same files are exercised by the ato-api instance-operation-bridge harness
(real Worker, D1 and Chromium): the calendar reads two due dates, then a
revoked binding makes the next read fail while the TODO board stays intact.
Staging E2E with the deployed API is tracked separately.
