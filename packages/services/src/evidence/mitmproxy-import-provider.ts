import type {
  ImportProvider,
  ImportProviderInput,
  ImportProviderResult
} from "@software-analysis/core";

export class MitmproxyDumpImportProvider implements ImportProvider {
  readonly kind = "mitmproxy_dump" as const;

  parse(_input: ImportProviderInput): Promise<ImportProviderResult> {
    void _input;
    return Promise.resolve({
      evidence: [],
      warnings: [],
      failures: [
        {
          code: "MITMPROXY_DUMP_UNSUPPORTED",
          message:
            "mitmproxy dump parsing requires the versioned Python worker parser and is not enabled in this stage-two slice",
          recoverable: true
        }
      ]
    });
  }
}
