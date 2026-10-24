import type { WorkspaceMeta } from './packageDiscovery';

const SUPPORTED: Record<string, string[]> = {
  express: ['express'],
  nestjs: ['@nestjs/core', '@nestjs/common'],
  nextjs: ['next'],
  react: ['react'],
  axios: ['axios'],
  mongoose: ['mongoose', '@nestjs/mongoose'],
  prisma: ['@prisma/client', 'prisma'],
  typeorm: ['typeorm', '@nestjs/typeorm'],
  redis: ['redis', 'ioredis', '@nestjs/redis'],
  elasticsearch: ['@elastic/elasticsearch', '@opensearch-project/opensearch', '@nestjs/elasticsearch'],
  queues: ['bull', 'bullmq', '@nestjs/bull', '@nestjs/bullmq'],
};

/** Frameworks we recognize in package.json but have no adapter for. They get an explicit diagnostic, never silent omission. */
const UNSUPPORTED: Record<string, string> = {
  fastify: 'Fastify',
  koa: 'Koa',
  '@koa/router': 'Koa Router',
  '@hapi/hapi': 'hapi',
  hapi: 'hapi',
  restify: 'Restify',
  '@trpc/server': 'tRPC',
  '@apollo/server': 'Apollo GraphQL',
  'apollo-server': 'Apollo GraphQL',
  '@nestjs/graphql': 'NestJS GraphQL',
  graphql: 'GraphQL',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  '@remix-run/node': 'Remix',
  '@sveltejs/kit': 'SvelteKit',
  nuxt: 'Nuxt',
  '@nestjs/microservices': 'NestJS microservices (message patterns)',
  kafkajs: 'Kafka',
  amqplib: 'RabbitMQ',
};

export interface FrameworkDetection {
  frameworks: string[];
  unsupported: { name: string; packages: string[] }[];
}

export function detectFrameworks(meta: WorkspaceMeta): FrameworkDetection {
  const deps = new Map<string, Set<string>>();
  for (const pkg of meta.packages) for (const d of pkg.dependencies) (deps.get(d) ?? deps.set(d, new Set()).get(d)!).add(pkg.dir || '.');
  const frameworks = Object.entries(SUPPORTED)
    .filter(([, names]) => names.some((n) => deps.has(n)))
    .map(([fw]) => fw)
    .sort();
  const unsupportedMap = new Map<string, Set<string>>();
  for (const [dep, label] of Object.entries(UNSUPPORTED)) {
    if (deps.has(dep)) (unsupportedMap.get(label) ?? unsupportedMap.set(label, new Set()).get(label)!).add(dep);
  }
  const unsupported = [...unsupportedMap].map(([name, packages]) => ({ name, packages: [...packages].sort() })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return { frameworks, unsupported };
}
