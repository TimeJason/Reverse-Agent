import { FindingSchema } from "@software-analysis/core";
import type { Finding, FindingStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteFindingRepository
  extends JsonProjectScopedRepository<Finding>
  implements FindingStore
{
  constructor(client: SqliteClient) {
    super(client, "findings", FindingSchema, (finding) => ({
      confidence: finding.confidence,
      kind: finding.kind
    }));
  }
}
