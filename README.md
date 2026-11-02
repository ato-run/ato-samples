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

## Pinned root-source snapshots

Some source intake paths currently accept the repository root only. The following immutable fixture commits project the indicated directory as the root of the **new** source commit. They do not claim the original repository archive identity or replace validation of the new source. Their trees match the stated source directory exactly; each commit can be reproduced with `git subtree split --prefix=<directory> <source-commit>`. The tags make these commits reachable from this repository.

| Fixture | Source commit and directory | Root-source commit | Tag |
| --- | --- | --- | --- |
| Compute | `1090b26b8cbaf57acb7a1a18c010d3c260c78851:fixtures/compute-server` | `03b0a3577a7f8077b6480039ae4b270b8d074e9c` | `fixture-snapshot/compute-20261103` |
| Formation | `98610daf0960f0f949a7112ab675772a8793d2ed:fixtures/compute-server/formation` | `aba1022567ef4219e729248063cab84b2711c8e7` | `fixture-snapshot/formation-20261103` |
| Generic DOM | `935826385e8a43241c641278c15c598a3ceb8515:fixtures/generic-dom` | `517372400d4135d943b8ef3c75c78976bf3d5b95` | `fixture-snapshot/generic-dom-20261103` |

The Formation and Generic DOM source changes are still Draft. These snapshots have not passed actual staging Runner/Browser acceptance and do not authorize retirement of existing source URLs. Use an exact root-source commit, not a moving tag, when validating. Broader support for selecting a subdirectory from an original archive is tracked separately in ato-run/ato-api#1096.

The original sample repository provides `samples/LICENSE`. The sample tools lockfile has been updated to address npm audit findings; the other imported inputs are retained as supplied, except for the revised historical index in `samples/README.md`. The other imported repositories did not include a license at the pinned revisions; this migration does not assign new reuse terms to those files.
