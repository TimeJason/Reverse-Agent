import { EvidenceSourceSchema } from "@software-analysis/core";
import type { EvidenceSource, EvidenceSourceStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteEvidenceSourceRepository
  extends JsonProjectScopedRepository<EvidenceSource>
  implements EvidenceSourceStore
{
  constructor(client: SqliteClient) {
    super(client, "evidence_sources", EvidenceSourceSchema);
  }
}
