import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createWorkspaceLayout, initWorkspace, readProjectConfig } from "../src/index.js";

const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "software-analysis-"));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local workspace initialization", () => {
  test("creates project config and internal directories", async () => {
    const root = await tempProject();

    const result = await initWorkspace(root, {
      name: "Demo Project",
      workspaceName: "Local Workspace"
    });

    const configText = await readFile(join(root, "project.yaml"), "utf8");
    const config = await readProjectConfig(root);

    expect(result.config.name).toBe("Demo Project");
    expect(config.name).toBe("Demo Project");
    expect(config.project_schema_version).toBe(1);
    expect(configText).toContain("project_schema_version: 1");

    await expect(
      readFile(join(root, ".software-analysis", "db", ".gitkeep"))
    ).resolves.toBeDefined();
    await expect(
      readFile(join(root, ".software-analysis", "evidence", "raw", ".gitkeep"))
    ).resolves.toBeDefined();
    await expect(
      readFile(join(root, ".software-analysis", "audit", ".gitkeep"))
    ).resolves.toBeDefined();
  });

  test("refuses to initialize an existing workspace", async () => {
    const root = await tempProject();
    await initWorkspace(root, { name: "Demo Project", workspaceName: "Local Workspace" });

    await expect(
      initWorkspace(root, { name: "Demo Again", workspaceName: "Local Workspace" })
    ).rejects.toThrow(/already initialized/i);
  });

  test("keeps internal paths inside the project root", async () => {
    const root = await tempProject();
    const layout = createWorkspaceLayout(root);

    expect(() => layout.resolveInsideProject(".software-analysis/db")).not.toThrow();
    expect(() => layout.resolveInsideProject("../escape")).toThrow(/outside project root/i);
  });
});
