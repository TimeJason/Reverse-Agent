import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-postman-"));

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
    "postman",
    "--project",
    project,
    "--json"
  ]);
  const parsed = JSON.parse(output);
  const artifact = JSON.parse(
    await readFile(join(project, ".software-analysis", "artifacts", parsed.result.path), "utf8")
  );
  assert(artifact.info.schema.includes("collection/v2.1.0"), "missing Postman schema");
  assert(JSON.stringify(artifact).includes("{{base_url}}"), "missing base_url variable");
  assert(!JSON.stringify(artifact).includes("raw-token"), "secret leaked into Postman export");
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
