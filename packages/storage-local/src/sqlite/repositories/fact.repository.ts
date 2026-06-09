import { FactSchema } from "@software-analysis/core";
import type { Fact, FactStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteFactRepository extends JsonProjectScopedRepository<Fact> implements FactStore {
  constructor(client: SqliteClient) {
    super(client, "facts", FactSchema, (fact) => ({ kind: fact.kind }));
  }
}
