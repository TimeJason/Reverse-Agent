export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmRequest {
  project_id: string;
  prompt_version: string;
  messages: LlmMessage[];
  response_schema?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface LlmResponse {
  provider: string;
  model: string;
  content: string;
  structured?: Record<string, unknown>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
