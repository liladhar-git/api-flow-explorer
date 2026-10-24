import type { FrameworkAdapter } from './shared/adapter';
import { databaseAdapter } from './database';
import { expressAdapter } from './express';
import { nestAdapter } from './nestjs';
import { nextAdapter } from './nextjs';
import { reactAdapter } from './react';
import { httpClientAdapter } from './shared/httpClient';
import { requestUsageAdapter } from './shared/requestUsage';

/**
 * Registered framework adapters. During `extract`, order matters where one adapter reads another's classification:
 * nextjs sets execution boundaries that http-client reads, and react must not reclassify what nextjs already did.
 * During `link`, endpoint producers (express, nestjs) run before the request matcher, which the linker runs last.
 */
export const ALL_ADAPTERS: FrameworkAdapter[] = [nextAdapter, expressAdapter, nestAdapter, databaseAdapter, reactAdapter, httpClientAdapter, requestUsageAdapter];
