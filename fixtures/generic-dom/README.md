# Generic DOM collaboration fixture

Minimal portable Browser Capsule used to verify ato.run Capsule Invite flows.
It exports a direct application presentation Port using the `ato.http@1`
protocol and records/applies canonical interaction through the
`ato.browser@1` Adapter. HTTP presentation is not a second Evolution stream.

The application intentionally contains no Activity, Experience, game, or
Tobu-specific protocol. Its DOM includes a click counter, keyboard input,
scrollable content, and a draggable element.

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
