import { CaptureSessionSchema } from "@software-analysis/core";
import type { CaptureSession, CaptureSessionStore } from "@software-analysis/core";

import type { SqliteClient } from "../sqlite-client.js";
import { JsonProjectScopedRepository } from "./json-repository.js";

export class SqliteCaptureSessionRepository
  extends JsonProjectScopedRepository<CaptureSession>
  implements CaptureSessionStore
{
  constructor(client: SqliteClient) {
    super(client, "capture_sessions", CaptureSessionSchema);
  }
}
