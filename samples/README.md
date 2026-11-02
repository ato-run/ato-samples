# Imported sample collection

These files were imported from `ato-run/sample-capsules` at commit
`43d89ba6fbcb56f9b70d2840068351b6d97edd25`. They include older manifest
schemas and experiments; their presence is not a guarantee that they run on the
current CLI. See [ato#1681](https://github.com/ato-run/ato/issues/1681) for
work to verify selected examples against the current contract.

## Contents

- [`01-capabilities/`](01-capabilities/) — individual capability examples.
- [`03-limitations/`](03-limitations/) — examples intended to exercise failure
  or unsupported behavior in the historical CLI.
- `shared-json-todo/`, `shared-json-calendar/`, `react-vite/` and the other
  top-level directories — individual sample applications.
- [`source/`](source/) and [`expectations/`](expectations/) — source-shape
  inputs and expected-output placeholders described in
  [FIXTURE_README.md](FIXTURE_README.md).

`00-quickstart/` and `02-apps/` currently contain indexes, not a complete
quickstart or app suite. [MATRIX.md](MATRIX.md) and `docs/` are historical
records, not evidence of current cross-platform results.

## Validation

The repository-level `sample inputs` workflow validates the `health.toml`
metadata schema and the generic DOM fixture's static build. It does not run the
samples against every Ato version. The imported `samples/.github/` workflow is
historical and is not an active repository-level workflow. Its tool has
unimplemented checks, so its labels must not be treated as functional results.

For development, `npm ci --ignore-scripts` followed by `npm run validate` in
this directory checks the sample health metadata. It does not prove that an
individual sample forms or runs. Test a chosen sample with a pinned current
Ato revision and record the actual result before depending on it.

The imported sample collection is licensed under [Apache-2.0](LICENSE).
