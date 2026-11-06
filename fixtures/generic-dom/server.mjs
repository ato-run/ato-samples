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
    <title>Ato Public Launch Lab</title>
    <style>
      :root { font-family: system-ui, sans-serif; color-scheme: light; }
      body { margin: 0; background: #f5f2e9; color: #17211b; }
      main { max-width: 1180px; margin: 0 auto; padding: 16px 24px 32px; }
      h1 { margin: 0 0 4px; font-size: 26px; }
      main > p { margin: 4px 0 10px; }
      .card { margin-top: 12px; padding: 14px; border: 2px solid #17211b; border-radius: 16px; background: #fffdf6; box-shadow: 4px 4px 0 #17211b; }
      button, input { font: inherit; }
      button { padding: 10px 16px; border: 2px solid #17211b; border-radius: 999px; background: #f2c94c; cursor: pointer; }
      input { width: min(100%, 360px); padding: 10px 12px; border: 2px solid #17211b; border-radius: 10px; }
      [data-counter] { display: inline-block; min-width: 2ch; font-size: 42px; font-weight: 800; margin-left: 16px; }
      .scrollable { height: 120px; overflow: auto; border: 2px solid #17211b; border-radius: 10px; padding: 12px; }
      .scroll-content { height: 420px; background: linear-gradient(#d7f5de, #9cc7ff); }
      .drag-stage { position: relative; height: 130px; border: 2px dashed #17211b; border-radius: 10px; touch-action: none; }
      .drag-box { position: absolute; left: 16px; top: 28px; width: 72px; height: 72px; display: grid; place-items: center; border: 2px solid #17211b; border-radius: 12px; background: #e8a8ff; user-select: none; }
      output { display: block; margin-top: 6px; font-family: ui-monospace, monospace; }
      .archetypes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
      .archetype { position: relative; overflow: hidden; }
      .archetype h2 { margin: 8px 0; font-size: 22px; }
      .archetype p { min-height: 42px; margin: 6px 0; }
      .eyebrow { font: 700 11px ui-monospace, monospace; letter-spacing: .12em; text-transform: uppercase; color: #516b5b; }
      .game-board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; max-width: 170px; margin: 8px 0; padding: 7px; border-radius: 12px; background: #bbada0; }
      .tile { display: grid; aspect-ratio: 1; place-items: center; border-radius: 8px; background: #cdc1b4; font-size: clamp(16px, 4vw, 28px); font-weight: 850; }
      .tile.hot { color: #f9f6f2; background: #edc53f; }
      .tile.won { color: #f9f6f2; background: #edc22e; box-shadow: 0 0 0 4px rgba(237,194,46,.25); }
      .pixel-grid { display: grid; grid-template-columns: repeat(8, 20px); width: fit-content; margin: 8px 0; border: 4px solid #17211b; background: #fff; }
      .pixel { width: 20px; height: 20px; padding: 0; border: 1px solid rgba(23,33,27,.12); border-radius: 0; background: #f4efe5; }
      .pixel.done { background: #ff7455; }
      .pixel.seed { background: #17211b; }
      .test-line { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 10px 0; padding: 10px; border: 2px solid #17211b; border-radius: 10px; font-family: ui-monospace, monospace; }
      .test-state { color: #b42318; font-weight: 850; }
      .test-line.fixed .test-state { color: #18794e; }
      @media (max-width: 520px) {
        .archetypes { grid-template-columns: 1fr; }
        .archetype p { min-height: 0; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Ato Public Launch Lab</h1>
      <p>Three ordinary Browser computations. No product-specific bridge is installed.</p>
      <div class="archetypes">
        <section class="card archetype" id="play">
          <span class="eyebrow">Play · one move</span>
          <h2>2048 is one move away</h2>
          <p>Press ArrowRight or use the button to merge the final pair.</p>
          <div class="game-board" aria-label="2048 board">
            <span class="tile"></span><span class="tile"></span><span class="tile"></span><span class="tile"></span>
            <span class="tile"></span><span class="tile"></span><span class="tile"></span><span class="tile"></span>
            <span class="tile"></span><span class="tile"></span><span class="tile"></span><span class="tile"></span>
            <span class="tile"></span><span class="tile"></span><span class="tile hot" id="tile-left">1024</span><span class="tile hot" id="tile-right">1024</span>
          </div>
          <button id="win-move" type="button">Make the winning move →</button>
          <output id="play-result">One move remaining</output>
        </section>
        <section class="card archetype" id="create">
          <span class="eyebrow">Create · eight pixels</span>
          <h2>Finish the signal</h2>
          <p>Fill the eight pale pixels. Every click changes the actual canvas state.</p>
          <div class="pixel-grid" id="pixel-grid" aria-label="Pixel art canvas"></div>
          <output id="pixel-result">8 pixels remaining</output>
        </section>
        <section class="card archetype" id="developer">
          <span class="eyebrow">Developer · one failing test</span>
          <h2>Repair the button contract</h2>
          <p>The fixture has exactly one obvious assertion failure and a one-line repair.</p>
          <div class="test-line" id="test-line">
            <code>button.label === "Save"</code>
            <span class="test-state" id="test-state">FAIL · got "Svae"</span>
          </div>
          <button id="apply-fix" type="button">Apply one-line fix</button>
          <output id="developer-result">1 failing · 7 passing</output>
        </section>
      </div>
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

      const win = () => {
        const left = document.querySelector('#tile-left');
        const right = document.querySelector('#tile-right');
        if (right.hidden) return;
        left.textContent = '2048';
        left.classList.add('won');
        right.hidden = true;
        document.querySelector('#play-result').textContent = 'You made 2048 · state changed';
      };
      document.querySelector('#win-move').addEventListener('click', win);
      window.addEventListener('keydown', (event) => {
        if (event.code === 'ArrowRight') win();
      });

      const pixelGrid = document.querySelector('#pixel-grid');
      const unfinished = new Set([9, 10, 17, 22, 25, 30, 42, 45]);
      for (let index = 0; index < 64; index += 1) {
        const pixel = document.createElement('button');
        pixel.type = 'button';
        pixel.className = 'pixel ' + (unfinished.has(index) ? '' : (index % 9 === 0 || index % 7 === 0 ? 'seed' : 'done'));
        pixel.setAttribute('aria-label', 'Pixel ' + (index + 1));
        if (unfinished.has(index)) {
          pixel.addEventListener('click', () => {
            if (!unfinished.delete(index)) return;
            pixel.classList.add('done');
            const remaining = unfinished.size;
            document.querySelector('#pixel-result').textContent = remaining === 0 ? 'Artwork complete · state changed' : remaining + ' pixels remaining';
          });
        }
        pixelGrid.append(pixel);
      }

      document.querySelector('#apply-fix').addEventListener('click', () => {
        document.querySelector('#test-line').classList.add('fixed');
        document.querySelector('#test-state').textContent = 'PASS · got "Save"';
        document.querySelector('#developer-result').textContent = '8 passing · state changed';
        document.querySelector('#apply-fix').textContent = 'Fix applied';
      });

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
