import { mkdir, rm, writeFile } from "node:fs/promises";

import { pageWithoutBrowserBridge, server } from "./server.mjs";

server.close();
await rm("dist-static", { force: true, recursive: true });
await mkdir("dist-static", { recursive: true });
const moduleMatch = pageWithoutBrowserBridge.match(
  /<script type="module">([\s\S]*?)<\/script>/u,
);
if (!moduleMatch) throw new Error("static fixture module not found");
const staticPage = pageWithoutBrowserBridge.replace(
  moduleMatch[0],
  '<script type="module" src="/app.js"></script>',
);
await writeFile("dist-static/index.html", staticPage);
await writeFile("dist-static/app.js", moduleMatch[1]);
