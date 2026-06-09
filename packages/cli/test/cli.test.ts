import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createCli } from "../src/index.js";

interface InitResult {
  ok: boolean;
  project: {
    name: string;
  };
}

interface StatusResult {
  ok: boolean;
  project: {
    project_schema_version: number;
  };
  storage: {
    tables: string[];
  };
}

interface DoctorResult {
  ok: boolean;
  checks: {
    node: {
      ok: boolean;
    };
  };
}

const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "software-analysis-cli-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("software-analysis cli", () => {
  test("initializes a project and reads project status as json", async () => {
    const root = await tempProject();
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "init", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "project",
      "status",
      "--project",
      root,
      "--json"
    ]);

    const initResult = JSON.parse(output[0] ?? "{}") as InitResult;
    const status = JSON.parse(output[1] ?? "{}") as StatusResult;

    expect(initResult.ok).toBe(true);
    expect(initResult.project.name).toBe("Demo Analysis");
    expect(status.ok).toBe(true);
    expect(status.project.project_schema_version).toBe(1);
    expect(status.storage.tables).toContain("projects");
  });

  test("returns doctor checks as json", async () => {
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "doctor", "--json"]);

    const result = JSON.parse(output[0] ?? "{}") as DoctorResult;
    expect(result.ok).toBe(true);
    expect(result.checks.node.ok).toBe(true);
  });
});
