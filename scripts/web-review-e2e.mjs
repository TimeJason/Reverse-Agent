import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const args = process.argv.slice(2);
const suite = args.at(args.indexOf("--suite") + 1);
if (suite !== "web-review") {
  console.log(`Skipping e2e suite: ${suite ?? "default"}`);
  process.exit(0);
}

const project = await mkdtemp(join(tmpdir(), "sa-web-"));
try {
  await run("node", ["packages/cli/dist/index.js", "init", project, "--json"]);
  await run("node", [
    "packages/cli/dist/index.js",
    "import",
    "har",
    "fixtures/har/checkout.har",
    "--project",
    project,
    "--json"
  ]);
  await run("node", [
    "packages/cli/dist/index.js",
    "api",
    "analyze",
    "--project",
    project,
    "--json"
  ]);
  const ui = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "ui",
      "--project",
      project,
      "--once",
      "--json"
    ])
  );
  assert(ui.url.startsWith("http://127.0.0.1:"), "UI did not bind a local review URL");
} finally {
  await rm(project, { recursive: true, force: true });
}

async function run(command, commandArgs) {
  const { stdout } = await exec(command, commandArgs, { cwd: root });
  return stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
