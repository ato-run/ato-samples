# Roadmap WBS/Gantt and calendar — 2026-11-10

Roadmap now offers WBS・ガント, カレンダー and the existing 概要 in the
sidebar. There are no added main-header view tabs. The same selectors apply
search, status, priority, due and archive conditions to all projections.

WBS shows Projects → Tickets → Subtasks, completion progress, immutable ticket
numbers, shared status/priority icons, a sticky label column and date header,
week/month/quarter zoom, Today and period navigation. Folding preserves the
scroll position and focus. Only real Project start/target dates become bars.
Task dueAt is a deadline marker; undated Tasks/Subtasks remain visible without
invented durations. Out-of-range dates offer a period jump. The WBS hierarchy
number is derived from visible order and does not change a Task's identity.

The calendar shows month and week views, adjacent month dates, Today, counts,
a selected-day agenda and an expandable undated list. Mobile month cells show
date/count, with full shared metadata in the agenda. Arrow/Home/End keys move
the focused date. Every Task link opens the existing drawer; edits still use
existing Operations. No additional copies, inferred recurrence instances,
Task dates, Protocols, access grants or write paths were added.

## Validation

- `corepack pnpm@10.23.0 typecheck`, JS syntax and diff checks pass.
- The focused browser-state fixture passes after the final JS corrections,
  including native/touch priority DnD, response-loss replay, stale rejection,
  existing Kanban gestures, WBS hierarchy, calendar, keyboard date selection,
  leap day/year navigation, drawer identity, sidebar close and scroll retention.
- The full Operation Bridge run passes all migrated, Project and browser-state
  UI suites, including Project CRUD, two tabs and existing 24 layout/theme views.
  New planning checks cover 320/390/768/1024/1440px × light/dark × WBS/calendar
  (20 projections for each storage profile), with no page overflow, zero write
  requests and identical complete document/head/digest. View controls are 44px.
- That combined run then hit an undici `ECONNRESET` in the unrelated large-body
  budget section. The unchanged budget and remaining Calendar/consent/revocation
  assertions passed in a fresh temporary runner that skipped the already-passed
  TODO UI suites. This is combined coverage, not a clean exit of the original
  all-in-one command. Physical iOS and screen-reader testing are not claimed.
- All three API packages and both sample packages build. 27 shared UI/core/Project
  targets were compared: 25 are byte-identical. The sample's operation-client
  and workspace-ui intentionally retain its Personal/Team/All and hosted Port
  requirements behavior. Its upstream #17–20 changes (`b07d344`) were fast-forwarded
  before applying this patch. Root v1 handlers/catalogs/ports match each starting
  HEAD; the sample's narrow Calendar handler is intentionally different from the
  API root handler and is preserved. Team coordinator e2e was not rerun.

Synthetic screenshots: [WBS mobile](task-board-roadmap-planning-2026-11-10/390-light-wbs.png),
[calendar mobile](task-board-roadmap-planning-2026-11-10/390-dark-calendar.png),
[WBS desktop](task-board-roadmap-planning-2026-11-10/1440-light-wbs.png).
Real production Task screenshots remain in local `.tmp/planning-production/`.

## Production

Same Instance `cinst_01M2J0WMJ6NW96ACZSWNGD0WV3`, same URL
https://cinst-igo4yublcxdlxf3u.app.ato.run/.

1. Initial Schema `csch_01M72GYN5XXHXRMHAPF5418A4B`, source
   `sha256:6ad91a8675090b03c0bc31b59b044060adae500c799172827ea26be8257a83ce`.
2. Digest-fenced six-file patch, valid preview, Formation
   `fjob_65bbb711d36139682180b7e8c514c230ce4dba80c27bb34c025934733ff044cb`, ready
   Schema `csch_01M72TC01VAGJAW875W5SHWS9Z`, source
   `sha256:e4e756f86ff99b818812d3c663bb4b58fe807703de0a572ed111aabae1739246`.
   CAS adoption `iupd_01M72TCTEVQ36CE1N0CK8W85H6`.
3. Production Chrome exposed a one-pixel horizontal overflow scrollbar in the
   narrow sidebar. A CSS-only digest-fenced follow-up contains horizontal nav
   overflow while retaining vertical scrolling. Formation
   `fjob_feb4b582da41601fa0928e8a3be576a78882c2510b929bbc4a885c309d7bd3cc`, ready
   **Schema `csch_01M72THZDBJEBHE63330X0WPR5`**, final source
   **`sha256:60b2c2047339b84c17050a82c35b90657413af73291dc7cb6cb0008a9a8ea2ba`**.
   CAS adoption `iupd_01M72TJDXQ7JKZ431G5132EWMW`.

Both adoptions compare complete immediate pre/post public read-only projections:
**210 Tasks, 137 archived, 73 active, 7 recurrences, board revision 760**,
`persisted=false`, identical. Fresh catalogs retain all five public MCP Operation
contracts and implementation digests; only Schema-bound refs rotate. All 23
untouched source files retain their digests, including the frozen original
mutation handler, declarations, private Observation and four old assets.

Authenticated production Chrome confirms 73 WBS Tasks, subtask expansion, Today
centering, month/7-day calendar, date-selected agenda, sidebar close, no page
horizontal overflow at 390px and removal of the sidebar scrollbar. Final viewport
overrides were reset. No real Task was edited for verification.

Production remains server-owned `ato.browser-instance-state@1`, not a migrated
DataResource. Its existing Tasks appear under Unassigned. Project-period bars
work in the unregistered projects-v2 candidate. No platform deployment, feature
flag, Resource migration, production Project persistence or permission change
was performed. An earlier ready candidate `csch_01M72T4B5AGHEZ5GC17X4FS4DD`
was superseded before adoption by the navigation/focus/scroll correction.
