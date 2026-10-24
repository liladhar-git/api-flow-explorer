import { z } from 'zod';

export const EndpointSummarySchema = z.object({
  id: z.string(),
  method: z.string(),
  path: z.string(),
  framework: z.string(),
  file: z.string(),
  line: z.number(),
});
