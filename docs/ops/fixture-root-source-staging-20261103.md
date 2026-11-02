# Fixture root-source staging check — 2026-11-03 JST

This records source intake only. It is not a staging release gate, a Hosted Run, a Browser Runner test, or a Contract verification receipt.

- `ato-samples` root-source commits: Formation `aba1022567ef4219e729248063cab84b2711c8e7`; Generic DOM `517372400d4135d943b8ef3c75c78976bf3d5b95`.
- Each published Git tree matched the corresponding fixture directory's Git tree at the source commits documented in the root README.
- With the shared staging deploy lease held, Chrome Studio prepared each exact root source in the private isolated path and displayed the requested commit, `/` selection, and the source-ready state.
- The Formation source-only public admission flow also reported `source_materialized`: source job `fjob_sa_950b50937d4678a684790060d75adcacb9ba24ba61ba914ed97c49ba10237ac1`, tree `sha256:69763095965f63abbd1d09c3f22cd9c0a1de1a8a0d53841c1e5390feff805ca9`, closure `sha256:37605e5d7ad8a417306e777a6b57ba515eee4ef4a59805c73beec09441e556a8`, two files. Public process admission remained `approval_required`; no operator approval was granted.
- Private Formation created schema `csch_01M6EQCVXKQDFQCKQR28NN0DN1` and instance `cinst_01M6EQD3780J1Q8Q11B97GB7QR` from that exact Formation commit. Selecting Hosted returned a plan-entitlement requirement; the local Runner option was unavailable. No actual HTTP observation or attempt-bound verification receipt was obtained. The test-created instance and its test dataset were removed via UI; source job records remain as evidence.
- API Worker version was `d2e3501f-e463-450a-9e5f-daf260ad22fd` and PWA Worker version `3a0c83fd-e94d-4359-a8a4-5ad1cc5c5ca0` at both boundaries; the PWA asset was `/assets/main-CL4--I9Y.js`. The lease was released. No deployment or flag change was made.

The existing lifecycle release gate remains unavailable: the two fixtures pinned by `ato-staging-capsule-lifecycle-e2e` return 404. Do not retire the old compute-server or generic-dom repositories until their intended fixed-source Runner/Browser acceptance succeeds. Root-source snapshots do not implement original-archive subdirectory selection, tracked separately by ato-api#1096.
