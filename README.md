# Ato samples

Examples, demonstrations, and fixtures used to explore and test Ato.

- `samples/`: historical example and fixture inputs from `sample-capsules`.
- `demos/capsule-continuation/`: interactive explanation of a Capsule and its Runs.
- `fixtures/compute-server/`: a dynamic HTTP fixture.
- `fixtures/generic-dom/`: an external-origin Browser Capsule fixture.

Each directory is an independent input. Historical example manifests and tools may refer to older CLI contracts. Their presence does not establish current compatibility. The legacy sample CI contains incomplete checks and is retained only for reference; its old assertions do not constitute release evidence. See ato-run/ato#1681 for current-CLI verification.

The two fixture directories are copied from public repositories at the revisions recorded below. Existing pinned GitHub source references must remain available until consumers have been migrated and tested against this repository. No claim is made that a subdirectory import works on every existing import path.

| Source | Revision | Destination |
| --- | --- | --- |
| `ato-run/sample-capsules` | `43d89ba6fbcb56f9b70d2840068351b6d97edd25` | `samples/` |
| `ato-run/ato-capsule-demo` | `e830a25fac0b2d35aa4c4fd98653faffabb09cf4` | `demos/capsule-continuation/` |
| `ato-run/ato-e2e-compute-server` | `4f442f1ad27ae6a27eb3341283a4bb666cbdda2e` | `fixtures/compute-server/` |
| `ato-run/ato-activity-generic-dom-fixture` | `c252e15533523731d30b6cecaf91077d70046761` | `fixtures/generic-dom/` |

The original sample repository provides `samples/LICENSE`. The sample tools lockfile has been updated to address npm audit findings; the other imported inputs are retained as supplied, except for a status note in `samples/README.md`. The other imported repositories did not include a license at the pinned revisions; this migration does not assign new reuse terms to those files.
