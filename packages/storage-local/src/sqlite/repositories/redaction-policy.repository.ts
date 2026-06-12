import { RedactionPolicySchema } from "@software-analysis/core";
import type { RedactionPolicy, RedactionPolicyStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteRedactionPolicyRepository
  extends JsonProjectScopedRepository<RedactionPolicy>
  implements RedactionPolicyStore
{
  constructor(client: SqliteClient) {
    super(client, "redaction_policies", RedactionPolicySchema, (policy) => ({
      version: policy.version
    }));
  }

  getActiveForProject(projectId: string): Promise<RedactionPolicy | null> {
    const row = this.client
      .prepare(
        `select payload_json from redaction_policies
         where project_id = ?
         order by version desc, id desc
         limit 1`
      )
      .get(projectId);

    return Promise.resolve(this.parseRow(row));
  }
}
