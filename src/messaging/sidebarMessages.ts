import { z } from 'zod';
import { EndpointSummarySchema } from './endpointSummarySchema';
import { FilterStateSchema } from './filterStateSchema';

/** An entry in the sidebar's secondary groups (requests, services, models, external APIs). */
export const SidebarItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Short secondary text, e.g. a file path. */
  sub: z.string(),
});

export const SidebarGroupsSchema = z.object({
  requests: z.array(SidebarItemSchema),
  services: z.array(SidebarItemSchema),
  models: z.array(SidebarItemSchema),
  externals: z.array(SidebarItemSchema),
});

/** Messages the sidebar webview may send. Graph items are named by ID only. */
export const SidebarToHostSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('openEndpoint'), id: z.string().min(1).max(2000) }),
  /** Any listed item (request, service, model, external API): focus it in the graph. */
  z.object({ type: z.literal('openItem'), id: z.string().min(1).max(2000) }),
  z.object({ type: z.literal('scan') }),
  z.object({ type: z.literal('setFilters'), filters: FilterStateSchema }),
]);
export type SidebarToHost = z.infer<typeof SidebarToHostSchema>;

export const HostToSidebarSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    hasAnalysis: z.boolean(),
    scanning: z.boolean(),
    endpoints: z.array(EndpointSummarySchema),
    groups: SidebarGroupsSchema,
    filters: FilterStateSchema,
  }),
  z.object({ type: z.literal('filters'), filters: FilterStateSchema }),
  z.object({ type: z.literal('focusSearch') }),
]);
export type HostToSidebar = z.infer<typeof HostToSidebarSchema>;
export type SidebarItem = z.infer<typeof SidebarItemSchema>;
export type SidebarGroups = z.infer<typeof SidebarGroupsSchema>;
