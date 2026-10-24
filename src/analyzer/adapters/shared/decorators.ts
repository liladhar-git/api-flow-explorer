import { Node, type Decorator } from 'ts-morph';
import { moduleRef } from '../../importResolver';
import { unwrapExpression } from '../../symbolResolver';

/** Decorators on a node whose name was imported from one of `modules` (syntactic check; works without installed typings). */
export function decoratorsFrom(node: Node, modules: string[], names?: string[]): Decorator[] {
  if (!Node.isDecoratable(node)) return [];
  const out: Decorator[] = [];
  for (const d of node.getDecorators()) {
    const ref = moduleRef(d.getNameNode());
    const name = d.getName();
    if (!ref || !modules.some((m) => ref.module === m || ref.module.startsWith(m + '/'))) continue;
    // `import { Controller } from '@nestjs/common'` → member === 'Controller'; aliases keep the original member name
    const original = ref.member ?? name;
    if (names && !names.includes(original)) continue;
    out.push(d);
  }
  return out;
}

export function decoratorName(d: Decorator): string {
  const ref = moduleRef(d.getNameNode());
  return ref?.member ?? d.getName();
}

export function firstArg(d: Decorator): Node | undefined {
  const a = d.getArguments()[0];
  return a ? unwrapExpression(a) : undefined;
}
