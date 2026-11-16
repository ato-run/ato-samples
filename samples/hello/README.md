# Hello, Ato

The Ato first-run Capsule tutorial. One command opens a tiny interactive page
on your own computer:

~~~sh
ato run capsules/ato/hello
~~~

This public reference works **only after the Ato publisher has published an
accepted bundle**. Until then, use the local recipe below. This is a Capsule
Hub tutorial, not an ato.run Discover application.

## Pack, run, and verify

Requires the released `ato` CLI **v0.9.2 or later**. From the root of
[ato-samples](https://github.com/ato-run/ato-samples):

~~~sh
mkdir -p .tmp/hello
ato pack samples/hello -o .tmp/hello/hello.capsule
ato run .tmp/hello/hello.capsule

# Headless verification: no browser, with a receipt you can inspect
ato run .tmp/hello/hello.capsule --no-open \
  --verification-receipt .tmp/hello/receipt.json
~~~

The recipe uses **`schema = "ato.capsule/2"`** and has exactly one Derivation,
so no `--derivation` selector is needed for a first run.

| Concept | Here |
| --- | --- |
| Contract (K) | `GET /` returns 200; `GET /proof.txt` returns 200 with the declared SHA-256 body digest. |
| Derivation (D) | `ato.browser@1`, serving a local static web surface starting at `index.html`. |
| Receipt | The CLI verifies that both observations passed, not merely that the source packed. |

The page's **Say hello** button is ordinary local JavaScript. It does not
require a sign-in, backend, external network, cookies, localStorage or
writable state. The button interaction is **not** part of the Contract or
a durable receipt; it is just a friendly confirmation that the UI is alive.

## Change it and learn

1. Edit `index.html` to change the screen or button.
2. Read `capsule.toml` to see the actual Contract and Derivation.
3. Read `proof.txt` to see the exact bytes protected by the Contract.
4. Pack and run again. A source change produces a new immutable bundle;
   it must not silently rewrite an already published digest.
5. If `proof.txt` changes, deliberately update the Contract's `body_digest`.
   On a Mac, run `shasum -a 256 samples/hello/proof.txt` and use the exact hash.

## Publish to Capsule Hub (authorized Ato publisher only)

First verify that the publishing account owns the registry namespace `ato`.
Do not publish under a personal namespace or impersonate another publisher.
For the **staging** registry:

~~~sh
ato login --api-url https://staging.api.ato.run
ato hub publish .tmp/hello/hello.capsule \
  --name ato/hello --tag latest --license Apache-2.0 \
  --readme samples/hello/README.md \
  --repository https://github.com/ato-run/ato-samples \
  --display-name "Hello, Ato" \
  --summary "Your first Capsule: open, inspect, pack and publish." \
  --surface web_ui --environment macos-arm64 \
  --api-url https://staging.api.ato.run

# Verify the published digest and an actual successful Run
ato run capsules/ato/hello --api-url https://staging.api.ato.run \
  --no-open --verification-receipt .tmp/hello/staging-receipt.json
~~~

Do **not** treat a successful local pack as public registration. Production
requires a separate release gate, a real receipt and namespace authorization.
The existing private encrypted `ato hub push/pull` is a separate feature.

## License

Apache-2.0, as part of the Ato samples repository (see `../LICENSE`).
