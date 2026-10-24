import { z } from 'zod';

export const FilterStateSchema = z.object({
  query: z.string().max(500),
  category: z.enum(['all', 'frontend', 'backend']),
  methods: z.array(z.string().max(16)).max(12),
  frameworks: z.array(z.string().max(32)).max(24),
  hiddenKinds: z.array(z.string().max(32)).max(24),
  hiddenConfidence: z.array(z.enum(['high', 'medium', 'low', 'unresolved'])).max(4),
});
