import { mkdir, readFile, writeFile, cp, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
const args = process.argv.slice(2),
  profile = args[args.indexOf("--profile") + 1],
  output = args[args.indexOf("--out") + 1];
if (
  !["current", "projects-v2"].includes(profile) ||
  !output ||
  resolve(output) === resolve("samples/shared-json-todo")
)
  throw new Error(
    "Usage: node scripts/build-todo-profile.mjs --profile current|projects-v2 --out .tmp/<directory>",
  );
const root = resolve("samples/shared-json-todo"),
  out = resolve(output);
if (!out.startsWith(resolve(".tmp") + "/"))
  throw new Error("Output must be under this checkout .tmp/");
await mkdir(out, { recursive: true });
for (const name of await readdir(root)) {
  if (["profiles", "README.md"].includes(name)) continue;
  await cp(join(root, name), join(out, name), { recursive: true });
}
if (profile === "projects-v2") {
  const overrides = join(root, "profiles/projects-v2");
  for (const name of [
    "ato.data.toml",
    "ato.operations.yaml",
    "schema.jsonc",
    "src",
  ])
    await cp(join(overrides, name), join(out, name), { recursive: true });
  await writeFile(
    join(out, "index.html"),
    (await readFile(join(out, "index.html"), "utf8")).replace(
      'data-project-operations="false"',
      'data-project-operations="true"',
    ),
  );
}
if (profile === "projects-v2")
  await writeFile(join(out, "index.html"),
    (await readFile(join(out, "index.html"), "utf8")).replace(
      'data-priority-move="false"', 'data-priority-move="true"'));
console.log(out);
