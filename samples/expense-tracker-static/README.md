# expense-tracker-static

The Personal Apps v0 acceptance fixture.

It exists to make ONE property falsifiable:

> Data entered on one device is present, from the App's first render, when the
> same person opens the same App from a different browser.

Everything about it is shaped by that. It has no build step, no dependencies
and no framework, so a failed restore can only ever mean the state lane is
broken — never that a bundler stripped something. `app.js` reads
`localStorage` **synchronously in its first statement**: if the instance state
bridge has not finished hydrating by then, the list renders empty and the test
fails, which is exactly the failure the fixture is here to catch.

## Acceptance

Run against staging with the Personal Apps flag on. The App is added twice —
once from this GitHub path and once from a local copy of this folder — and
both must behave identically.

1. Adding it from `github.com/ato-run/sample-capsules` (subdirectory
   `expense-tracker-static`) produces an App.
2. Adding the same folder from disk produces a second, independent App.
3. Reopening the App URL returns the same URL — it never rotates.
4. An expense added in browser A is on screen in a **fresh profile** browser B
   at first render, without interaction.
5. `setItem`, `removeItem` and `clear` all survive a reload.
6. Two accounts running the same App never see each other's expenses.
7. Signed out → sign-in; a different account → refused.
8. No Ato session cookie, bearer or control credential appears in the App's
   JavaScript or in the served artifact.
9. An update past the size ceiling is refused and the previous good state is
   still there.
10. After removing the App, its URL is `410` — permanently, never reassigned.
11. Public Static Web delivery, Activity and Run-based App Proxy are unchanged.
12. Opening the App consumes no cloud Runner slot.

Criteria 4 and 12 are the ones that make this v0 rather than a deployment
demo. A build that succeeds and serves is not a pass.
