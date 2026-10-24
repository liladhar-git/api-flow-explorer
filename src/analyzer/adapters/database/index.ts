import { Node, SyntaxKind, type CallExpression, type ClassDeclaration } from 'ts-morph';
import type { GraphNode } from '../../../types/graph';
import { edgeId, symId } from '../../../graph/ids';
import type { FileContext } from '../../fileContext';
import { moduleRef } from '../../importResolver';
import { unwrapExpression } from '../../symbolResolver';
import { decoratorsFrom, firstArg } from '../shared/decorators';
import { handlerRef } from '../shared/handlers';
import type { FrameworkAdapter } from '../shared/adapter';
import { bindingOf, eventTarget, prismaRawTarget, queueTarget, type Binding, type Target } from './bindings';
import { accessOf, OPS } from './ops';

const SCALAR_LIBS = new Set(['mongoose', 'typeorm', 'prisma', 'redis', 'elasticsearch']);

function extract(ctx: FileContext): void {
  const seenNodes = new Set<string>();
  const addNode = (t: Target) => {
    if (seenNodes.has(t.id)) return;
    seenNodes.add(t.id);
    const node: GraphNode = { id: t.id, kind: t.kind, name: t.name, path: t.path, startLine: t.line, metadata: t.meta };
    ctx.facts.nodes.push(node);
  };
  const emit = (source: string, kind: 'reads' | 'writes' | 'publishes' | 'subscribes', target: Target, line: number, explanation: string, inferred = false) => {
    addNode(target);
    ctx.facts.edges.push({
      id: edgeId(kind, source, target.id),
      source,
      target: target.id,
      kind,
      evidence: { path: ctx.path, line, explanation },
      confidence: inferred ? 'medium' : 'high',
      resolution: inferred ? 'inferred' : 'resolved',
    });
  };
  /** Consumer edges point from the queue to its consumer so edge direction follows execution flow. */
  const emitConsumer = (queue: Target, consumer: string, line: number, explanation: string) => {
    addNode(queue);
    ctx.facts.edges.push({
      id: edgeId('subscribes', queue.id, consumer),
      source: queue.id,
      target: consumer,
      kind: 'subscribes',
      evidence: { path: ctx.path, line, explanation },
      confidence: 'high',
      resolution: 'resolved',
    });
  };

  // --- declarations: schema/entity classes and queue consumers ----------------------------------
  for (const cls of ctx.nodesOf<ClassDeclaration>(SyntaxKind.ClassDeclaration)) {
    const name = cls.getName();
    if (!name) continue;
    if (decoratorsFrom(cls, ['@nestjs/mongoose'], ['Schema'])[0]) addNode({ id: `model:${name}`, kind: 'model', name, meta: { orm: 'mongoose' }, path: ctx.path, line: cls.getStartLineNumber() });
    if (decoratorsFrom(cls, ['typeorm'], ['Entity'])[0]) addNode({ id: `model:${name}`, kind: 'model', name, meta: { orm: 'typeorm' }, path: ctx.path, line: cls.getStartLineNumber() });

    const proc = decoratorsFrom(cls, ['@nestjs/bull', '@nestjs/bullmq'], ['Processor'])[0];
    if (proc) {
      const arg = firstArg(proc);
      const qname = arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) ? arg.getLiteralText() : undefined;
      if (qname) {
        const q = queueTarget(qname, 'bull', ctx.path, cls.getStartLineNumber());
        for (const m of cls.getMethods()) {
          const isProcess = decoratorsFrom(m, ['@nestjs/bull', '@nestjs/bullmq'], ['Process', 'Processor'])[0] || (m.getName() === 'process' && cls.getExtends()?.getExpression().getText() === 'WorkerHost');
          if (isProcess) emitConsumer(q, symId(ctx.path, `${name}.${m.getName()}`), m.getStartLineNumber(), `@Processor('${qname}') consumes jobs in ${name}.${m.getName()}`);
        }
      }
    }
    for (const m of cls.getMethods()) {
      const on = decoratorsFrom(m, ['@nestjs/event-emitter'], ['OnEvent'])[0];
      const arg = on ? firstArg(on) : undefined;
      if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) {
        emitConsumer(eventTarget(arg.getLiteralText()), symId(ctx.path, `${name}.${m.getName()}`), m.getStartLineNumber(), `@OnEvent('${arg.getLiteralText()}') handles the event in ${name}.${m.getName()}`);
      }
    }
  }

  // --- new Worker('queue', handler) -------------------------------------------------------------
  for (const nw of ctx.nodesOf<import('ts-morph').NewExpression>(SyntaxKind.NewExpression)) {
    const ref = moduleRef(nw.getExpression());
    if (ref && (ref.module === 'bullmq') && ref.member === 'Worker') {
      const qn = unwrapExpression(nw.getArguments()[0]);
      const handler = nw.getArguments()[1];
      if (qn && (Node.isStringLiteral(qn) || Node.isNoSubstitutionTemplateLiteral(qn)) && handler) {
        const h = handlerRef(ctx, handler, `worker ${qn.getLiteralText()}`);
        if (h.id) emitConsumer(queueTarget(qn.getLiteralText(), 'bullmq', ctx.path, nw.getStartLineNumber()), h.id, nw.getStartLineNumber(), `Worker('${qn.getLiteralText()}') processes jobs with ${h.text}`);
      }
    }
  }

  // --- call sites: recv.op(...) -----------------------------------------------------------------
  for (const call of ctx.nodesOf<CallExpression>(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    const op = callee.getName();
    const recv = callee.getExpression();
    const binding: Binding | undefined = bindingOf(ctx, recv);
    if (!binding) continue;
    const owner = ctx.ownerOf(call);
    const line = call.getStartLineNumber();
    const recvText = recv.getText().replace(/\s+/g, ' ').slice(0, 40);
    const via = `${recvText}.${op}()`;

    if (SCALAR_LIBS.has(binding.lib)) {
      const lib = binding.lib as keyof typeof OPS;
      if (binding.client && binding.lib === 'prisma') {
        const raw = /^\$(queryRaw|queryRawUnsafe)$/.test(op) ? 'reads' : /^\$(executeRaw|executeRawUnsafe)$/.test(op) ? 'writes' : undefined;
        if (raw) emit(owner, raw, prismaRawTarget(), line, `${via} runs raw SQL through Prisma (${binding.evidence})`);
        continue;
      }
      if (!binding.target) continue;
      let access = binding.instance ? (op === 'save' ? 'writes' : undefined) : accessOf(lib, op);
      let inferred = false;
      if (!access && lib === 'typeorm' && op === 'createQueryBuilder') {
        access = 'reads';
        inferred = true;
      }
      if (!access) continue;
      let detail = '';
      if (lib === 'elasticsearch') {
        const o = unwrapExpression(call.getArguments()[0]);
        const idx = o && Node.isObjectLiteralExpression(o) ? o.getProperty('index') : undefined;
        const v = idx && Node.isPropertyAssignment(idx) ? unwrapExpression(idx.getInitializer()) : undefined;
        if (v && Node.isStringLiteral(v)) detail = ` index "${v.getLiteralText()}"`;
      }
      if (lib === 'redis' && (op === 'publish' || op === 'subscribe')) continue;
      emit(owner, access, binding.target, line, `${via} ${access === 'reads' ? 'reads from' : 'writes to'} ${binding.target.name}${detail} (${binding.evidence})${inferred ? '; query builder, read/write not determined' : ''}`, inferred);
      continue;
    }

    if (binding.lib === 'redis') continue;

    if (binding.lib === 'queue' && binding.target) {
      if (op === 'add' || op === 'addBulk') emit(owner, 'publishes', binding.target, line, `${via} enqueues a job on ${binding.target.name} (${binding.evidence})`);
      else if (op === 'process' && call.getArguments().length) {
        const h = handlerRef(ctx, call.getArguments()[call.getArguments().length - 1], `consumer ${binding.target.name}`);
        if (h.id) emitConsumer(binding.target, h.id, line, `${via} registers ${h.text} to process ${binding.target.name}`);
      }
      continue;
    }

    if (binding.lib === 'event') {
      const nameNode = unwrapExpression(call.getArguments()[0]);
      const ev = nameNode && (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) ? nameNode.getLiteralText() : undefined;
      if (!ev) continue;
      if (op === 'emit' || op === 'emitAsync') emit(owner, 'publishes', eventTarget(ev), line, `${via} emits event "${ev}" (${binding.evidence})`);
      else if ((op === 'on' || op === 'once' || op === 'addListener') && call.getArguments()[1]) {
        const h = handlerRef(ctx, call.getArguments()[1], `on ${ev}`);
        if (h.id) emitConsumer(eventTarget(ev), h.id, line, `${via} registers ${h.text} for event "${ev}"`);
      }
    }
  }
}

export const databaseAdapter: FrameworkAdapter = { name: 'database', extract };
