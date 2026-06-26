import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const { stdout } = await exec(
  "node",
  ["packages/cli/dist/index.js", "bench", "manifest", "--json"],
  {
    cwd: process.cwd()
  }
);
const parsed = JSON.parse(stdout);
assert(
  parsed.result.profiles.some((profile) => profile.name === "L"),
  "missing L benchmark"
);
assert(
  parsed.result.profiles.every((profile) => profile.min_metadata_retention_ratio === 1),
  "metadata retention must be 1"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
