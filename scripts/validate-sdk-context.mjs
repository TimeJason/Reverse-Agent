import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-sdk-"));

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
    "import",
    "browser-events",
    "fixtures/browser/checkout-events.jsonl",
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
  await run("node", [
    "packages/cli/dist/index.js",
    "analyze",
    "workflows",
    "--project",
    project,
    "--json"
  ]);
  await run("node", [
    "packages/cli/dist/index.js",
    "analyze",
    "entities",
    "--project",
    project,
    "--json"
  ]);
  const output = await run("node", [
    "packages/cli/dist/index.js",
    "export",
    "sdk-context",
    "--project",
    project,
    "--json"
  ]);
  const parsed = JSON.parse(output);
  const artifact = JSON.parse(
    await readFile(join(project, ".software-analysis", "artifacts", parsed.result.path), "utf8")
  );
  assert(artifact.schema_version === 1, "missing SDK context schema version");
  assert(artifact.endpoints.length > 0, "SDK context missing endpoints");
  assert(artifact.evidence_refs.length > 0, "SDK context missing evidence refs");
  assert(!JSON.stringify(artifact).includes("raw-token"), "secret leaked into SDK context");
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
