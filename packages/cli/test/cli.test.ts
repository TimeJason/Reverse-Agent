import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createCli } from "../src/index.js";
import { resolveAllowedProjectPath } from "../src/local-project.js";

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

interface DoctorReportResult {
  ok: boolean;
  result: {
    telemetry: "disabled";
    checks: { name: string; ok: boolean }[];
  };
}

interface BenchmarkResult {
  ok: boolean;
  result: {
    profiles: { name: string; min_metadata_retention_ratio: number }[];
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

  test("imports HAR and searches redacted traffic", async () => {
    const root = await tempProject();
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "init", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "har",
      resolve("../../fixtures/har/login.har"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "traffic",
      "search",
      "--project",
      root,
      "--host",
      "api.example.test",
      "--json"
    ]);

    const importResult = JSON.parse(output[1] ?? "{}") as {
      ok: boolean;
      result: { evidence_count: number };
    };
    const searchResult = JSON.parse(output[2] ?? "{}") as {
      ok: boolean;
      result: { items: unknown[] };
    };
    const serialized = JSON.stringify(searchResult);

    expect(importResult.ok).toBe(true);
    expect(importResult.result.evidence_count).toBe(2);
    expect(searchResult.result.items).toHaveLength(2);
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("raw-cookie");
  });

  test("analyzes API surface and exports OpenAPI through CLI", async () => {
    const root = await tempProject();
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "init", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "har",
      resolve("../../fixtures/har/login.har"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "api",
      "analyze",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync(["node", "software-analysis", "api", "list", "--project", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "export",
      "openapi",
      "--project",
      root,
      "--json"
    ]);

    const analysis = JSON.parse(output[2] ?? "{}") as {
      result: { endpoint_count: number };
    };
    const endpoints = JSON.parse(output[3] ?? "{}") as {
      result: { path_template: string }[];
    };
    const artifact = JSON.parse(output[4] ?? "{}") as {
      result: { path: string };
    };

    expect(analysis.result.endpoint_count).toBe(2);
    expect(endpoints.result.map((endpoint) => endpoint.path_template)).toEqual([
      "/login",
      "/orders"
    ]);
    expect(artifact.result.path).toMatch(/openapi-/);
  });

  test("imports browser events and analyzes business understanding through CLI", async () => {
    const root = await tempProject();
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "init", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "har",
      resolve("../../fixtures/har/checkout.har"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "browser-events",
      resolve("../../fixtures/browser/checkout-events.jsonl"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "api",
      "analyze",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "analyze",
      "workflows",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "analyze",
      "entities",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "analyze",
      "state-transitions",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "workflows",
      "list",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "entities",
      "list",
      "--project",
      root,
      "--json"
    ]);

    const workflowAnalysis = JSON.parse(output[4] ?? "{}") as {
      result: { fact_ids: string[] };
    };
    const entityAnalysis = JSON.parse(output[5] ?? "{}") as {
      result: { fact_ids: string[] };
    };
    const workflows = JSON.parse(output[7] ?? "{}") as {
      result: { steps: unknown[]; mermaid: string }[];
    };
    const entities = JSON.parse(output[8] ?? "{}") as {
      result: { name: string }[];
    };

    expect(workflowAnalysis.result.fact_ids).toHaveLength(1);
    expect(entityAnalysis.result.fact_ids.length).toBeGreaterThanOrEqual(2);
    expect(workflows.result.at(0)?.steps.length).toBeGreaterThanOrEqual(4);
    expect(workflows.result.at(0)?.mermaid).toContain("flowchart TD");
    expect(entities.result.map((entity) => entity.name)).toEqual(expect.arrayContaining(["Order"]));
  });

  test("rejects MCP project file imports outside the project root", async () => {
    const root = await tempProject();

    expect(() => resolveAllowedProjectPath(root, "../secret.txt")).toThrow(/project root/i);
  });

  test("runs phase six doctor, bench, plugin validation, and artifact diff commands", async () => {
    const root = await tempProject();
    const manifest = join(root, "plugin.json");
    const output: string[] = [];
    const cli = createCli({ stdout: (text: string) => output.push(text) });

    await cli.parseAsync(["node", "software-analysis", "init", root, "--json"]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "doctor",
      "report",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync(["node", "software-analysis", "bench", "manifest", "--json"]);
    await writeFile(
      manifest,
      JSON.stringify({
        name: "example-log-provider",
        type: "import_provider",
        version: "0.1.0",
        compatible_with: { core: ">=1.0 <2.0" },
        capabilities: ["import_provider"]
      })
    );
    await cli.parseAsync([
      "node",
      "software-analysis",
      "plugins",
      "validate",
      manifest,
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "har",
      resolve("../../fixtures/har/login.har"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "api",
      "analyze",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "export",
      "openapi",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "import",
      "har",
      resolve("../../fixtures/har/checkout.har"),
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "api",
      "analyze",
      "--project",
      root,
      "--json"
    ]);
    await cli.parseAsync([
      "node",
      "software-analysis",
      "export",
      "openapi",
      "--project",
      root,
      "--json"
    ]);
    const before = JSON.parse(output[6] ?? "{}") as { result: { artifact_id: string } };
    const after = JSON.parse(output[9] ?? "{}") as { result: { artifact_id: string } };
    await cli.parseAsync([
      "node",
      "software-analysis",
      "artifacts",
      "diff",
      "--project",
      root,
      "--before",
      before.result.artifact_id,
      "--after",
      after.result.artifact_id,
      "--json"
    ]);

    const doctor = JSON.parse(output[1] ?? "{}") as DoctorReportResult;
    const benchmark = JSON.parse(output[2] ?? "{}") as BenchmarkResult;
    const plugin = JSON.parse(output[3] ?? "{}") as { ok: boolean; result: { ok: boolean } };
    const diff = JSON.parse(output[10] ?? "{}") as { result: { entry_count: number } };

    expect(doctor.result.telemetry).toBe("disabled");
    expect(benchmark.result.profiles.map((profile) => profile.name)).toEqual(["S", "M", "L"]);
    expect(
      benchmark.result.profiles.every((profile) => profile.min_metadata_retention_ratio === 1)
    ).toBe(true);
    expect(plugin.ok).toBe(true);
    expect(plugin.result.ok).toBe(true);
    expect(diff.result.entry_count).toBeGreaterThan(0);
  });
});
