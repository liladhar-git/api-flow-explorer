import { Node } from 'ts-morph';
import type { Metadata } from '../../../types/graph';
import { databaseId, modelId, queueId } from '../../../graph/ids';
import type { FileContext } from '../../fileContext';
import { moduleRef } from '../../importResolver';
import { isStringLike } from '../../staticString';
import { unwrapExpression } from '../../symbolResolver';
import { decoratorsFrom, firstArg } from '../shared/decorators';
import type { Lib } from './ops';

export interface Target {
  id: string;
  kind: 'model' | 'database' | 'queue';
  name: string;
  meta: Metadata;
  path?: string;
  line?: number;
}

export interface Binding {
  lib: Lib;
  /** The value is a connection/client (Prisma client, event emitter) rather than a concrete target. */
  client?: boolean;
  /** The value is an instance of a model (`new User()`), so `save()` writes. */
  instance?: boolean;
  target?: Target;
  /** What evidence established this binding (shown in edge explanations). */
  evidence: string;
}

const REDIS_MODULES = ['ioredis', 'redis', '@nestjs/redis', '@liaoliaots/nestjs-redis', '@nestjs-modules/ioredis'];
const ES_MODULES = ['@elastic/elasticsearch', '@opensearch-project/opensearch', '@nestjs/elasticsearch'];
const QUEUE_MODULES = ['bull', 'bullmq', '@nestjs/bull', '@nestjs/bullmq'];

export const redisTarget = (): Target => ({ id: databaseId('redis'), kind: 'database', name: 'Redis', meta: { engine: 'redis' } });
export const esTarget = (): Target => ({ id: databaseId('elasticsearch'), kind: 'database', name: 'Elasticsearch', meta: { engine: 'elasticsearch' } });
export const prismaRawTarget = (): Target => ({ id: databaseId('prisma'), kind: 'database', name: 'Prisma (raw SQL)', meta: { engine: 'prisma' } });
export const queueTarget = (name: string, transport: string, path?: string, line?: number): Target => ({ id: queueId(name), kind: 'queue', name, meta: { transport }, path, line });
export const eventTarget = (name: string): Target => ({ id: queueId(`event:${name}`), kind: 'queue', name: `event: ${name}`, meta: { transport: 'event' } });

function modelTarget(orm: string, name: string, at?: { path?: string; line?: number }): Target {
  return { id: modelId(name), kind: 'model', name, meta: { orm }, path: at?.path, line: at?.line };
}

/** Model name from `User`, `User.name`, `'User'`; also reports the class declaration site when known. */
function modelNameOf(ctx: FileContext, arg: Node | undefined): { name: string; path?: string; line?: number } | undefined {
  const e = unwrapExpression(arg);
  if (!e) return undefined;
  if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) return { name: e.getLiteralText() };
  const ident = Node.isPropertyAccessExpression(e) && e.getName() === 'name' ? unwrapExpression(e.getExpression()) : e;
  if (ident && (Node.isIdentifier(ident) || Node.isPropertyAccessExpression(ident))) {
    for (const d of ctx.resolve(Node.isPropertyAccessExpression(ident) ? ident.getNameNode() : ident)) {
      if (Node.isClassDeclaration(d) && d.getName()) {
        return { name: d.getName()!, path: ctx.relPathOfFile(d.getSourceFile()), line: d.getStartLineNumber() };
      }
    }
    if (Node.isIdentifier(ident) && !Node.isPropertyAccessExpression(e)) return undefined;
  }
  return undefined;
}

function queueNameOf(arg: Node | undefined): string | undefined {
  const e = unwrapExpression(arg);
  return e && (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) ? e.getLiteralText() : undefined;
}

function typeRefName(t: Node | undefined): { node: Node; name: string; args: Node[] } | undefined {
  if (!t || !Node.isTypeReference(t)) return undefined;
  const nameNode = t.getTypeName();
  return { node: nameNode, name: nameNode.getText().replace(/^.*\./, ''), args: t.getTypeArguments() };
}

function classExtendsPrisma(ctx: FileContext, ident: Node): boolean {
  for (const d of ctx.resolve(ident)) {
    if (Node.isClassDeclaration(d)) {
      const ext = d.getExtends()?.getExpression();
      const ref = ext ? moduleRef(ext) : undefined;
      if (ref?.module === '@prisma/client' && ref.member === 'PrismaClient') return true;
    }
  }
  return false;
}

/** Binding established by a constructor parameter / class property: decorators first, then its declared type. */
export function bindingOfMember(ctx: FileContext, decl: Node): Binding | undefined {
  if (Node.isDecoratable(decl)) {
    const inj = decoratorsFrom(decl, ['@nestjs/mongoose'], ['InjectModel'])[0];
    if (inj) {
      const m = modelNameOf(ctx, firstArg(inj));
      if (m) return { lib: 'mongoose', target: modelTarget('mongoose', m.name, m), evidence: `@InjectModel(${m.name})` };
    }
    const repo = decoratorsFrom(decl, ['@nestjs/typeorm'], ['InjectRepository'])[0];
    if (repo) {
      const m = modelNameOf(ctx, firstArg(repo));
      if (m) return { lib: 'typeorm', target: modelTarget('typeorm', m.name, m), evidence: `@InjectRepository(${m.name})` };
    }
    const q = decoratorsFrom(decl, QUEUE_MODULES, ['InjectQueue'])[0];
    if (q) {
      const name = queueNameOf(firstArg(q)) ?? 'default';
      return { lib: 'queue', target: queueTarget(name, 'bull'), evidence: `@InjectQueue('${name}')` };
    }
    if (decoratorsFrom(decl, REDIS_MODULES, ['InjectRedis'])[0]) return { lib: 'redis', target: redisTarget(), evidence: '@InjectRedis()' };
  }
  const typed = decl as unknown as { getTypeNode?: () => Node | undefined; getInitializer?: () => Node | undefined };
  const t = typeRefName(typed.getTypeNode?.());
  if (t) {
    const ref = moduleRef(t.node);
    if (ref?.module === 'mongoose' && t.name === 'Model' && t.args[0]) {
      const argName = t.args[0].getText();
      return { lib: 'mongoose', target: modelTarget('mongoose', argName.replace(/Document$|Doc$/, '')), evidence: `typed Model<${argName}>` };
    }
    if (ref?.module === 'typeorm' && t.name === 'Repository' && t.args[0]) {
      const argName = t.args[0].getText();
      return { lib: 'typeorm', target: modelTarget('typeorm', argName), evidence: `typed Repository<${argName}>` };
    }
    if (ref?.module === '@prisma/client' && t.name === 'PrismaClient') return { lib: 'prisma', client: true, evidence: 'typed PrismaClient' };
    if (ref && classExtendsPrisma(ctx, t.node)) return { lib: 'prisma', client: true, evidence: `${t.name} extends PrismaClient` };
    if (ref && REDIS_MODULES.includes(ref.module) && (t.name === 'Redis' || t.name === 'RedisClientType')) return { lib: 'redis', target: redisTarget(), evidence: `typed ${t.name}` };
    if (ref && ES_MODULES.includes(ref.module)) return { lib: 'elasticsearch', target: esTarget(), evidence: `typed ${t.name}` };
    if (ref && QUEUE_MODULES.includes(ref.module) && t.name === 'Queue') return { lib: 'queue', target: queueTarget('(unnamed queue)', 'bull'), evidence: 'typed Queue' };
    if (ref?.module === '@nestjs/event-emitter' && t.name === 'EventEmitter2') return { lib: 'event', client: true, evidence: 'typed EventEmitter2' };
  }
  const init = typed.getInitializer?.();
  return init ? bindingOfInit(ctx, init, 0) : undefined;
}

function bindingOfInit(ctx: FileContext, init: Node | undefined, depth: number): Binding | undefined {
  const e = unwrapExpression(init);
  if (!e || depth > 4) return undefined;
  if (Node.isAwaitExpression(e)) return bindingOfInit(ctx, e.getExpression(), depth + 1);
  if (Node.isBinaryExpression(e)) {
    const op = e.getOperatorToken().getText();
    if (op === '||' || op === '??') return bindingOfInit(ctx, e.getRight(), depth + 1) ?? bindingOfInit(ctx, e.getLeft(), depth + 1);
  }
  if (Node.isConditionalExpression(e)) return bindingOfInit(ctx, e.getWhenTrue(), depth + 1) ?? bindingOfInit(ctx, e.getWhenFalse(), depth + 1);
  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) return bindingOf(ctx, e, depth + 1);

  if (Node.isCallExpression(e)) {
    const callee = e.getExpression();
    const ref = moduleRef(callee);
    if (ref?.module === 'mongoose' && ref.member === 'model') {
      const m = modelNameOf(ctx, e.getArguments()[0]);
      if (m) return { lib: 'mongoose', target: modelTarget('mongoose', m.name, { path: ctx.relPathOfFile(e.getSourceFile()), line: e.getStartLineNumber() }), evidence: `mongoose.model('${m.name}')` };
    }
    if (ref?.module === 'redis' && ref.member === 'createClient') return { lib: 'redis', target: redisTarget(), evidence: 'redis.createClient()' };
    if (ref?.module === 'typeorm' && (ref.member === 'getRepository' || ref.member === 'getCustomRepository')) {
      const m = modelNameOf(ctx, e.getArguments()[0]);
      if (m) return { lib: 'typeorm', target: modelTarget('typeorm', m.name, m), evidence: `${ref.member}(${m.name})` };
    }
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'getRepository') {
      const m = modelNameOf(ctx, e.getArguments()[0]);
      if (m && typeormImported(ctx)) return { lib: 'typeorm', target: modelTarget('typeorm', m.name, m), evidence: `getRepository(${m.name})` };
    }
  }
  if (Node.isNewExpression(e)) {
    const ref = moduleRef(e.getExpression());
    if (ref) {
      if (REDIS_MODULES.includes(ref.module) && (ref.member === undefined || ref.member === 'Redis' || ref.member === 'Cluster')) return { lib: 'redis', target: redisTarget(), evidence: `new ${e.getExpression().getText()}()` };
      if (ES_MODULES.includes(ref.module) && ref.member === 'Client') return { lib: 'elasticsearch', target: esTarget(), evidence: 'new Client()' };
      if (ref.module === '@prisma/client' && ref.member === 'PrismaClient') return { lib: 'prisma', client: true, evidence: 'new PrismaClient()' };
      if (QUEUE_MODULES.includes(ref.module) && ref.member === 'Queue') {
        const name = queueNameOf(e.getArguments()[0]);
        if (name) return { lib: 'queue', target: queueTarget(name, ref.module.includes('mq') ? 'bullmq' : 'bull', ctx.relPathOfFile(e.getSourceFile()), e.getStartLineNumber()), evidence: `new Queue('${name}')` };
      }
      if ((ref.module === 'events' || ref.module === 'node:events') && (ref.member === undefined || ref.member === 'EventEmitter')) return { lib: 'event', client: true, evidence: 'new EventEmitter()' };
    }
    // new User(data): an instance of a known model
    const inner = unwrapExpression(e.getExpression());
    if (inner && (Node.isIdentifier(inner) || Node.isPropertyAccessExpression(inner))) {
      const b = bindingOf(ctx, inner, depth + 1);
      if (b && b.lib === 'mongoose' && b.target && !b.instance) return { ...b, instance: true, evidence: `${b.evidence} instance` };
    }
  }
  return undefined;
}

function typeormImported(ctx: FileContext): boolean {
  return ctx.sf.getImportDeclarations().some((i) => i.getModuleSpecifierValue().startsWith('typeorm') || i.getModuleSpecifierValue().startsWith('@nestjs/typeorm'));
}

/**
 * Establishes what a receiver expression is (a Mongoose model, Prisma client, Redis connection, queue, ...) from
 * declaration evidence only: initializers, decorators and declared types — never from names.
 */
export function bindingOf(ctx: FileContext, expr: Node | undefined, depth = 0): Binding | undefined {
  const e = unwrapExpression(expr);
  if (!e || depth > 5) return undefined;

  if (Node.isPropertyAccessExpression(e)) {
    const base = unwrapExpression(e.getExpression());
    if (base && Node.isThisExpression(base)) {
      for (const d of ctx.resolve(e.getNameNode())) {
        if (Node.isParameterDeclaration(d) || Node.isPropertyDeclaration(d)) {
          const b = bindingOfMember(ctx, d);
          if (b) return b;
        }
      }
      return undefined;
    }
    // prisma.user → model delegate
    const parent = bindingOf(ctx, base, depth + 1);
    if (parent?.lib === 'prisma' && parent.client && !e.getName().startsWith('$')) {
      const name = e.getName().charAt(0).toUpperCase() + e.getName().slice(1);
      return { lib: 'prisma', target: modelTarget('prisma', name), evidence: `${parent.evidence} → .${e.getName()}` };
    }
    // namespace/import member: `models.User`
    for (const d of ctx.resolve(e.getNameNode())) {
      const b = declBinding(ctx, d, depth);
      if (b) return b;
    }
    return undefined;
  }

  if (Node.isIdentifier(e)) {
    for (const d of ctx.resolve(e)) {
      const b = declBinding(ctx, d, depth);
      if (b) return b;
    }
    return undefined;
  }
  if (Node.isCallExpression(e) || Node.isNewExpression(e)) return bindingOfInit(ctx, e, depth + 1);
  return undefined;
}

function declBinding(ctx: FileContext, d: Node, depth: number): Binding | undefined {
  if (Node.isVariableDeclaration(d)) {
    const typed = d.getTypeNode();
    const fromInit = bindingOfInit(ctx, d.getInitializer(), depth + 1);
    if (fromInit) return fromInit;
    return typed ? bindingOfMember(ctx, d) : undefined;
  }
  if (Node.isParameterDeclaration(d) || Node.isPropertyDeclaration(d)) return bindingOfMember(ctx, d);
  if (Node.isExportAssignment(d)) return bindingOfInit(ctx, d.getExpression(), depth + 1);
  if (Node.isClassDeclaration(d)) {
    // TypeORM ActiveRecord: class User extends BaseEntity → User.find()
    const ext = d.getExtends()?.getExpression();
    const ref = ext ? moduleRef(ext) : undefined;
    if (ref?.module === 'typeorm' && ref.member === 'BaseEntity' && d.getName()) {
      return { lib: 'typeorm', target: modelTarget('typeorm', d.getName()!, { path: ctx.relPathOfFile(d.getSourceFile()), line: d.getStartLineNumber() }), evidence: `${d.getName()} extends BaseEntity` };
    }
  }
  return undefined;
}

export { isStringLike };
