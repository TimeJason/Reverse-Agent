import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-compat-"));
const manifest = join(project, "plugin.json");

try {
  await run("node", ["packages/cli/dist/index.js", "init", project, "--json"]);
  await writeFile(
    manifest,
    JSON.stringify({
      name: "example-log-provider",
      type: "import_provider",
      version: "0.1.0",
      compatible_with: { core: ">=1.0 <2.0" },
      capabilities: ["import_provider"],
      permissions: { raw_evidence: false, network: false, filesystem: false }
    })
  );
  const accepted = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "plugins",
      "validate",
      manifest,
      "--project",
      project,
      "--json"
    ])
  );
  await writeFile(
    manifest,
    JSON.stringify({
      name: "raw-reader",
      type: "import_provider",
      version: "0.1.0",
      compatible_with: { core: ">=1.0 <2.0" },
      capabilities: ["import_provider"],
      permissions: { raw_evidence: true }
    })
  );
  const rejected = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "plugins",
      "validate",
      manifest,
      "--project",
      project,
      "--json"
    ])
  );
  assert(accepted.ok === true, "compatible plugin should pass");
  assert(rejected.ok === false, "raw evidence plugin should be rejected");
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
