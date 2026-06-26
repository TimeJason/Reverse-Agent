import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-diff-"));

try {
  await run("node", ["packages/cli/dist/index.js", "init", project, "--json"]);
  await run("node", [
    "packages/cli/dist/index.js",
    "import",
    "har",
    "fixtures/har/login.har",
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
  const before = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "export",
      "openapi",
      "--project",
      project,
      "--json"
    ])
  );
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
  const after = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "export",
      "openapi",
      "--project",
      project,
      "--json"
    ])
  );
  const diff = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "artifacts",
      "diff",
      "--project",
      project,
      "--before",
      before.result.artifact_id,
      "--after",
      after.result.artifact_id,
      "--json"
    ])
  );
  assert(diff.result.entry_count > 0, "expected artifact diff entries");
} finally {
  await rm(project, { recursive: true, force: true });
}

async function run(command, args) {
  const { stdout } = await exec(command, args, { cwd: root });
  return stdout;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
