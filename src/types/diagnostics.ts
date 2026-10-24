import { z } from 'zod';

export const DiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);

export const DiagnosticCodeSchema = z.enum([
  'parse-error',
  'unresolved-import',
  'unresolved-alias',
  'dynamic-import',
  'dynamic-route',
  'dynamic-url',
  'unknown-base-url',
  'unsupported-framework',
  'unsupported-syntax',
  'unresolved-handler',
  'unresolved-mount',
  'ambiguous-match',
  'unmatched-request',
  'duplicate-alias',
  'file-skipped',
  'file-limit',
  'config',
  'internal',
]);
export type DiagnosticCode = z.infer<typeof DiagnosticCodeSchema>;

export const AnalysisDiagnosticSchema = z.object({
  severity: DiagnosticSeveritySchema,
  code: DiagnosticCodeSchema,
  message: z.string(),
  path: z.string().optional(),
  line: z.number().int().optional(),
});
export type AnalysisDiagnostic = z.infer<typeof AnalysisDiagnosticSchema>;
