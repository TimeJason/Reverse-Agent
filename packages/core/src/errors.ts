import { z } from "zod";

export const AnalysisErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean(),
  details: z.record(z.string(), z.unknown()).optional()
});

export type AnalysisError = z.infer<typeof AnalysisErrorSchema>;

export function createAnalysisError(error: AnalysisError): AnalysisError {
  return AnalysisErrorSchema.parse(error);
}
