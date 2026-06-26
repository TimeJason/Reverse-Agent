export interface BenchmarkProfile {
  name: "S" | "M" | "L";
  requests: number;
  max_duration_ms: number;
  max_memory_mb: number;
  min_metadata_retention_ratio: number;
}

export interface BenchmarkManifest {
  schema_version: 1;
  generated_at: string;
  profiles: BenchmarkProfile[];
}

export class BenchmarkManifestService {
  createDefaultManifest(): BenchmarkManifest {
    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      profiles: [
        {
          name: "S",
          requests: 100,
          max_duration_ms: 5_000,
          max_memory_mb: 256,
          min_metadata_retention_ratio: 1
        },
        {
          name: "M",
          requests: 10_000,
          max_duration_ms: 60_000,
          max_memory_mb: 768,
          min_metadata_retention_ratio: 1
        },
        {
          name: "L",
          requests: 1_000_000,
          max_duration_ms: 3_600_000,
          max_memory_mb: 2_048,
          min_metadata_retention_ratio: 1
        }
      ]
    };
  }
}
