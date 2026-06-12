import { ArtifactSchema } from "@software-analysis/core";
import type { Artifact, ArtifactStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteArtifactRepository
  extends JsonProjectScopedRepository<Artifact>
  implements ArtifactStore
{
  constructor(client: SqliteClient) {
    super(client, "artifacts", ArtifactSchema, (artifact) => ({ kind: artifact.kind }));
  }
}
