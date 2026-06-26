import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-openapi-"));

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
  const output = await run("node", [
    "packages/cli/dist/index.js",
    "export",
    "openapi",
    "--project",
    project,
    "--json"
  ]);
  const parsed = JSON.parse(output);
  const artifact = JSON.parse(
    await readFile(join(project, ".software-analysis", "artifacts", parsed.result.path), "utf8")
  );
  const operations = Object.values(artifact.paths ?? {}).flatMap((pathItem) =>
    Object.values(pathItem)
  );

  assert(artifact.openapi === "3.1.0", "missing OpenAPI 3.1 marker");
  assert(typeof artifact.info?.title === "string", "missing OpenAPI info.title");
  assert(operations.length > 0, "missing OpenAPI operations");
  assert(
    operations.every((operation) => Array.isArray(operation["x-analysis"]?.evidence_refs)),
    "operation missing evidence refs"
  );
  assert(
    operations.every((operation) => typeof operation["x-analysis"]?.pipeline_run_id === "string"),
    "operation missing pipeline_run_id"
  );
  assert(!JSON.stringify(artifact).includes("raw-token"), "secret leaked into OpenAPI export");
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
