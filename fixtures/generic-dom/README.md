# Generic DOM collaboration fixture

Minimal portable Browser Capsule used to verify ato.run Capsule Invite flows.
It exports a direct application presentation Port using the `ato.http@1`
protocol and records/applies canonical interaction through the
`ato.browser@1` Adapter. HTTP presentation is not a second Evolution stream.

The application intentionally contains no Activity, Experience, game, or
Tobu-specific protocol. Its DOM includes three Public Launch archetypes over
the same generic Browser Port:

- Play: a visually obvious 2048 winning move;
- Create: eight unfinished pixels on a self-owned canvas;
- Developer: exactly one failing UI assertion with a one-line repair.

The original click, keyboard, scroll, and drag probes remain below them. Every
state change is ordinary application DOM state driven through `ato.browser@1`.

## Browser Runner Bridge v0 fixture

This repository is also the cooperative external-site reference integration.
It serves the version-pinned `browser-runner-bridge-v0.1.2.js` artifact from
its own origin, opts in with explicit Controller/API origin allowlists, and
registers a small state projection for the counter. The Bridge binds Actor
authority from the attached connection; the DOM operation payload cannot pick
an Actor.

The checked-in bridge artifact must be byte-identical to the PWA release
artifact and the static materializer asset. Current SHA-256:

`202b72a15d7a8882f7054c765925695c94b93dce28e1b19613ab742e15752ac2`

Generate a static external-origin deployment directory with:

```sh
node build-site.mjs
```

## Verify

```sh
ato init .
ato stop .
ato encap .@main --materialize ato.replay@1 --output generic-dom.capsule
ato run generic-dom.capsule
```

## Public Launch archetypes (draft)

This directory includes the result of merging the fixture main `c252e15533523731d30b6cecaf91077d70046761` with [PR #1](https://github.com/ato-run/ato-activity-generic-dom-fixture/pull/1) head `e4dcf838e161cd84e091a98eec523cd3e9b1c0d2`. The upstream PR remains draft pending real staging Runner/Browser acceptance. This directory does not replace the existing revision-pinned source.
