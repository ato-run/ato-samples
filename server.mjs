import http from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const listen = process.env.APP_LISTEN ?? "127.0.0.1:38182";
const separator = listen.lastIndexOf(":");
const host = listen.slice(0, separator);
const port = Number.parseInt(listen.slice(separator + 1), 10);
export const browserRunnerBridge = readFileSync(
  new URL("./browser-runner-bridge-v0.1.2.js", import.meta.url),
);

export const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Generic DOM collaboration fixture</title>
    <style>
      :root { font-family: system-ui, sans-serif; color-scheme: light; }
      body { margin: 0; background: #f5f2e9; color: #17211b; }
      main { max-width: 760px; margin: 0 auto; padding: 32px; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      .card { margin-top: 20px; padding: 20px; border: 2px solid #17211b; border-radius: 16px; background: #fffdf6; box-shadow: 6px 6px 0 #17211b; }
      button, input { font: inherit; }
      button { padding: 10px 16px; border: 2px solid #17211b; border-radius: 999px; background: #f2c94c; cursor: pointer; }
      input { width: min(100%, 360px); padding: 10px 12px; border: 2px solid #17211b; border-radius: 10px; }
      [data-counter] { display: inline-block; min-width: 2ch; font-size: 42px; font-weight: 800; margin-left: 16px; }
      .scrollable { height: 120px; overflow: auto; border: 2px solid #17211b; border-radius: 10px; padding: 12px; }
      .scroll-content { height: 420px; background: linear-gradient(#d7f5de, #9cc7ff); }
      .drag-stage { position: relative; height: 130px; border: 2px dashed #17211b; border-radius: 10px; touch-action: none; }
      .drag-box { position: absolute; left: 16px; top: 28px; width: 72px; height: 72px; display: grid; place-items: center; border: 2px solid #17211b; border-radius: 12px; background: #e8a8ff; user-select: none; }
      output { display: block; margin-top: 10px; font-family: ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <main>
      <h1>Generic DOM collaboration fixture</h1>
      <p>No Activity-specific or application-specific bridge is installed.</p>
      <section class="card">
        <button id="increment" type="button">Increment</button>
        <span data-counter>0</span>
        <output id="last-event">ready</output>
        <output id="browser-runner-state">revision=0 · last_actor=none</output>
      </section>
      <section class="card">
        <label for="text-input">Keyboard input</label><br>
        <input id="text-input" autocomplete="off" placeholder="Focus, then press Enter or ArrowRight">
      </section>
      <section class="card">
        <div class="scrollable" id="scrollable"><div class="scroll-content">Scrollable DOM content</div></div>
      </section>
      <section class="card">
        <div class="drag-stage" id="drag-stage"><div class="drag-box" id="drag-box">Drag</div></div>
      </section>
    </main>
    <script type="module">
      /* ato-external-bridge:start */
      import {
        BrowserDomOperationAdapter,
        createAtoBrowserBridge,
      } from "/__ato/browser-runner-bridge-v0.1.2.js";
      /* ato-external-bridge:end */

      const counter = document.querySelector('[data-counter]');
      const lastEvent = document.querySelector('#last-event');
      const browserRunnerState = document.querySelector('#browser-runner-state');
      let browserRevision = 0;
      let lastBrowserActor = null;
      const increment = (source) => {
        counter.textContent = String(Number(counter.textContent) + 1);
        lastEvent.textContent = source;
      };
      document.querySelector('#increment').addEventListener('click', () => increment('click'));
      document.querySelector('#text-input').addEventListener('keydown', (event) => {
        if (event.code === 'Enter' || event.code === 'ArrowRight') increment('key:' + event.code);
      });
      document.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        if (event.code === 'KeyX' || event.key.toLowerCase() === 'x') {
          increment('semantic:+1');
        } else if (event.code === 'KeyZ' || event.key.toLowerCase() === 'z') {
          counter.textContent = String(Number(counter.textContent) - 1);
          lastEvent.textContent = 'semantic:-1';
        }
      }, { capture: true });

      const stage = document.querySelector('#drag-stage');
      const box = document.querySelector('#drag-box');
      let dragging = false;
      stage.addEventListener('pointerdown', (event) => {
        dragging = event.target === box;
        lastEvent.textContent = 'pointerdown';
      });
      stage.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        const bounds = stage.getBoundingClientRect();
        box.style.left = Math.max(0, Math.min(bounds.width - box.offsetWidth, event.clientX - bounds.left - box.offsetWidth / 2)) + 'px';
        box.style.top = Math.max(0, Math.min(bounds.height - box.offsetHeight, event.clientY - bounds.top - box.offsetHeight / 2)) + 'px';
        lastEvent.textContent = 'pointermove';
      });
      stage.addEventListener('pointerup', () => { dragging = false; lastEvent.textContent = 'pointerup'; });
      stage.addEventListener('pointercancel', () => { dragging = false; lastEvent.textContent = 'pointercancel'; });

      /* ato-external-bridge:start */
      const launchIdentity = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (launchIdentity.has('parent_origin')) {
        const dom = new BrowserDomOperationAdapter();
        const bridge = createAtoBrowserBridge({
          allowedControllerOrigins: [
            'https://ato.run',
            'https://stg-app.ato.run',
            'http://127.0.0.1:4321',
            'http://localhost:4321',
          ],
          allowedCapabilityVerifierOrigins: [
            'https://api.ato.run',
            'https://staging.api.ato.run',
            'http://127.0.0.1:8787',
            'http://localhost:8787',
          ],
          applyOperation: (operation, authority) => {
            dom.apply(operation);
            browserRevision += 1;
            lastBrowserActor = authority.actor_id;
            browserRunnerState.textContent = 'revision=' + browserRevision + ' · last_actor=' + lastBrowserActor;
          },
          stateProvider: () => ({
            revision: browserRevision,
            summary: {
              value: Number(counter.textContent),
              revision: browserRevision,
              last_actor: lastBrowserActor,
            },
          }),
        });
        window.addEventListener('pagehide', () => bridge.dispose(), { once: true });
      }
      /* ato-external-bridge:end */
    </script>
  </body>
</html>`;

export const pageWithoutBrowserBridge = page.replace(
  /\s*\/\* ato-external-bridge:start \*\/[\s\S]*?\/\* ato-external-bridge:end \*\//gu,
  "",
);

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    connection: "close",
  });
  response.end(body);
}

export const server = http.createServer((request, response) => {
  if (request.url === "/ready") {
    send(response, 200, "application/json", JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url === "/__ato/browser-runner-bridge-v0.1.2.js") {
    send(response, 200, "text/javascript; charset=utf-8", browserRunnerBridge);
    return;
  }
  if (request.url !== "/") {
    send(response, 404, "text/plain; charset=utf-8", "not found");
    return;
  }
  send(response, 200, "text/html; charset=utf-8", page);
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, host);
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
