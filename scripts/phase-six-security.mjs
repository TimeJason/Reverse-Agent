import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const project = await mkdtemp(join(tmpdir(), "sa-sec-"));

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
  const doctor = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "doctor",
      "report",
      "--project",
      project,
      "--json"
    ])
  );
  assert(doctor.result.telemetry === "disabled", "telemetry must be disabled");
  assert(!JSON.stringify(doctor).includes("raw-token"), "diagnostics leaked secret");
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
