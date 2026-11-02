import { mkdir, rm, writeFile } from "node:fs/promises";

import { browserRunnerBridge, page, server } from "./server.mjs";

server.close();
await rm("dist", { force: true, recursive: true });
await mkdir("dist/__ato", { recursive: true });
await writeFile("dist/index.html", page);
await writeFile(
  "dist/__ato/browser-runner-bridge-v0.1.2.js",
  browserRunnerBridge,
);
