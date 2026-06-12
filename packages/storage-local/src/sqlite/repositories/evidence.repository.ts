import { EvidenceSchema } from "@software-analysis/core";
import type { Evidence, EvidenceStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteEvidenceRepository
  extends JsonProjectScopedRepository<Evidence>
  implements EvidenceStore
{
  constructor(client: SqliteClient) {
    super(client, "evidence_index", EvidenceSchema, (evidence) => ({
      kind: evidence.kind,
      observed_at: evidence.observed_at
    }));
  }

  override listByProject(projectId: string): Promise<Evidence[]> {
    const rows = this.client
      .prepare(
        `select payload_json from evidence_index
         where project_id = ?
         order by observed_at asc, id asc`
      )
      .all(projectId);

    return Promise.resolve(rows.map((row) => this.parseRequiredRow(row)));
  }
}
