import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BlobRef, BlobStore, PutBlobInput } from "@software-analysis/core";

import { createWorkspaceLayout } from "../workspace/workspace-layout.js";

export class FileBlobStore implements BlobStore {
  constructor(private readonly projectRoot: string) {}

  async put(input: PutBlobInput): Promise<BlobRef> {
    const hash = createHash("sha256").update(input.content).digest("hex");
    const ref: BlobRef = {
      id: `blob_${hash}`,
      hash,
      media_type: input.media_type,
      size: input.content.byteLength
    };
    const path = this.pathFor(ref);

    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, input.content);

    return ref;
  }

  async get(ref: BlobRef): Promise<Uint8Array | null> {
    try {
      const content = await readFile(this.pathFor(ref));
      return new Uint8Array(content);
    } catch {
      return null;
    }
  }

  pathFor(ref: BlobRef): string {
    const layout = createWorkspaceLayout(this.projectRoot);
    return join(layout.blobsDir, ref.hash.slice(0, 2), ref.hash);
  }
}
