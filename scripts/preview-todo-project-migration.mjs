// Read-only preparation. Never contacts an API, registers a protocol or mutates a Resource.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { upgradeBoard } from "../samples/shared-json-todo/profiles/projects-v2/src/operations/todo-v2.js";
const args = process.argv.slice(2),
  input = args[args.indexOf("--snapshot") + 1],
  output = args[args.indexOf("--out") + 1];
if (!input || !output || !resolve(output).startsWith(resolve(".tmp") + "/"))
  throw new Error(
    "Use --snapshot <exported Resource snapshot> --out .tmp/<preview.json>",
  );
const snapshot = JSON.parse(await readFile(input, "utf8"));
if (
  snapshot.protocol !== "todo.board@1" ||
  typeof snapshot.resource_id !== "string" ||
  !Number.isInteger(snapshot.revision) ||
  !Number.isInteger(snapshot.generation) ||
  !snapshot.access
)
  throw new Error(
    "Resource snapshot with protocol, revision, generation and access fences required",
  );
if (
  snapshot.document?.schemaVersion === 3 &&
  Object.hasOwn(snapshot.document, "projects")
)
  throw new Error("Existing projects field requires manual semantic review");
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}";
const digest = (value) =>
  "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
const document = upgradeBoard(snapshot.document);
if (canonical(document.tasks) !== canonical(snapshot.document.tasks))
  throw new Error("Task preservation failed");
const preview = {
  status: "approval_required",
  source: {
    resource_id: snapshot.resource_id,
    protocol: snapshot.protocol,
    resource_revision: snapshot.revision,
    generation: snapshot.generation,
    access: snapshot.access,
    document_digest: digest(snapshot.document),
  },
  target: {
    protocol_candidate: "todo.board@2",
    document,
    document_digest: digest(document),
  },
  requirements: [
    "Check target registry and publisher without overwriting an existing protocol",
    "Explicit approval of source digest, source fences, new Schema, new Resource and grants",
    "A separately reviewed comprehensive writer fence and drained invocations",
    "Verify snapshot again; copy to new Resource; verify; explicit rebind and Calendar reconsent",
    "Retain the original Resource",
  ],
  mutations_performed: false,
};
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify(preview, null, 2));
console.log(
  JSON.stringify({
    status: preview.status,
    mutations_performed: false,
    output: resolve(output),
  }),
);
