import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { FileBlobStore, initWorkspace } from "../src/index.js";

const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "software-analysis-blob-"));
  tempDirs.push(path);
  await initWorkspace(path, { name: "Demo Project", workspaceName: "Local Workspace" });
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("file blob store", () => {
  test("stores content by hash-addressed blob refs", async () => {
    const root = await tempProject();
    const store = new FileBlobStore(root);

    const ref = await store.put({
      content: new TextEncoder().encode("hello"),
      media_type: "text/plain"
    });

    expect(ref.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(ref.id).toBe(`blob_${ref.hash}`);
    await expect(store.get(ref)).resolves.toEqual(new TextEncoder().encode("hello"));
    await expect(readFile(store.pathFor(ref), "utf8")).resolves.toBe("hello");
  });
});
