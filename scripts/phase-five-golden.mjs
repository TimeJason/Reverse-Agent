import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const args = process.argv.slice(2);
const suite = args.at(args.indexOf("--suite") + 1);
if (suite !== "exporters-llm-rules") {
  console.log(`Skipping golden suite: ${suite ?? "default"}`);
  process.exit(0);
}

const project = await mkdtemp(join(tmpdir(), "sa-golden-"));
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
  await run("node", [
    "packages/cli/dist/index.js",
    "analyze",
    "state-transitions",
    "--project",
    project,
    "--json"
  ]);
  const rules = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "analyze",
      "business-rules",
      "--project",
      project,
      "--json"
    ])
  );
  const llm = JSON.parse(
    await run("node", [
      "packages/cli/dist/index.js",
      "llm",
      "enrich",
      "--project",
      project,
      "--json"
    ])
  );
  assert(rules.result.candidate_count > 0, "expected business rule candidates");
  assert(llm.result.status === "disabled", "LLM must be disabled by default");
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
