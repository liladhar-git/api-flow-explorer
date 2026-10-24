import { Node, SyntaxKind, type ArrowFunction, type CallExpression, type FunctionDeclaration, type FunctionExpression, type MethodDeclaration, type ObjectBindingPattern } from 'ts-morph';

type FunctionLikeDeclaration = ArrowFunction | FunctionExpression | FunctionDeclaration | MethodDeclaration;
import { emptySchema, mergeFields, MAX_FIELDS_PER_LEVEL, type FieldSchema, type FieldType, type RequestSchema } from '../../../types/requestSchema';
import type { FileContext } from '../../fileContext';
import { unwrapExpression } from '../../symbolResolver';
import type { FrameworkAdapter } from './adapter';
import { schemaFieldsOfType } from './schemaFromType';
import { zodObjectFields } from './schemaFromZod';

type Source = 'body' | 'query' | 'params';

const REQ_NAME = /^_?(req|request)$/i;
const REQ_TYPE = /(Request|Req)$/;
const SAFE_PROPS = new Set(['hasOwnProperty', 'toString', 'valueOf', 'constructor', 'length']);

function isFunctionLike(n: Node): n is FunctionLikeDeclaration {
  return Node.isFunctionDeclaration(n) || Node.isMethodDeclaration(n) || Node.isArrowFunction(n) || Node.isFunctionExpression(n);
}

/** `Request<Params, ResBody, ReqBody, ReqQuery>` generic arguments. */
function genericFields(ctx: FileContext, typeNode: Node | undefined, index: number): FieldSchema[] | undefined {
  if (!typeNode || !Node.isTypeReference(typeNode) || !/Request$/.test(typeNode.getTypeName().getText())) return undefined;
  return schemaFieldsOfType(ctx, typeNode.getTypeArguments()[index]);
}

function typeOfLiteral(init: Node | undefined): { type: FieldType; example?: string | number | boolean } {
  const e = init ? unwrapExpression(init) : undefined;
  if (!e) return { type: 'unknown' };
  if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e)) return { type: 'string', example: e.getLiteralText() };
  if (Node.isNumericLiteral(e)) return { type: 'number', example: Number(e.getText()) };
  if (e.getKind() === SyntaxKind.TrueKeyword || e.getKind() === SyntaxKind.FalseKeyword) return { type: 'boolean', example: e.getKind() === SyntaxKind.TrueKeyword };
  if (Node.isArrayLiteralExpression(e)) return { type: 'array' };
  if (Node.isObjectLiteralExpression(e)) return { type: 'object' };
  return { type: 'unknown' };
}

/** Fields read from `const { a, b = 1, c: { d } } = <source>`. */
function fieldsOfPattern(pattern: ObjectBindingPattern, required: boolean): FieldSchema[] {
  const out: FieldSchema[] = [];
  for (const el of pattern.getElements()) {
    if (el.getDotDotDotToken()) continue;
    const nameNode = el.getPropertyNameNode() ?? el.getNameNode();
    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
    if (!name) continue;
    const def = typeOfLiteral(el.getInitializer());
    const target = el.getNameNode();
    const nested = Node.isObjectBindingPattern(target) ? fieldsOfPattern(target, required) : undefined;
    out.push({
      name,
      type: nested?.length ? 'object' : def.type,
      required: required && !el.getInitializer(),
      ...(nested?.length ? { fields: nested } : {}),
      ...(def.example !== undefined ? { example: def.example } : {}),
    });
  }
  return out;
}

class Collector {
  readonly found: Record<Source, FieldSchema[]> = { body: [], query: [], params: [] };
  readonly sources: string[] = [];
  private readonly aliases = new Map<string, Source>(); // variable name → what it holds
  private readonly searchParamAliases = new Set<string>();
  /** `const url = new URL(req.url)` / `req.nextUrl`: `url.searchParams` is the query string. */
  private readonly urlAliases = new Set<string>();

  constructor(private readonly ctx: FileContext, private readonly fn: FunctionLikeDeclaration, private readonly req: string) {}

  private add(source: Source, f: FieldSchema) {
    this.found[source] = mergeFields(this.found[source], [f]).slice(0, MAX_FIELDS_PER_LEVEL);
  }

  private note(text: string) {
    if (!this.sources.includes(text)) this.sources.push(text);
  }

  /** Which request part an expression is: `req.body`, `await req.json()`, an alias variable, … */
  private sourceOf(expr: Node | undefined): Source | undefined {
    let e = expr ? unwrapExpression(expr) : undefined;
    if (!e) return undefined;
    if (Node.isAwaitExpression(e)) e = unwrapExpression(e.getExpression());
    if (!e) return undefined;
    if (Node.isIdentifier(e)) return this.aliases.get(e.getText());
    if (Node.isPropertyAccessExpression(e) && e.getExpression().getText() === this.req) {
      const n = e.getName();
      if (n === 'body' || n === 'query' || n === 'params') return n;
    }
    if (Node.isCallExpression(e)) {
      const c = unwrapExpression(e.getExpression());
      // await req.json() / req.clone().json()
      if (c && Node.isPropertyAccessExpression(c) && c.getName() === 'json' && /^(req|request)(\.clone\(\))?$/i.test(c.getExpression().getText().replace(/\s/g, '')) && c.getExpression().getText().startsWith(this.req)) return 'body';
    }
    return undefined;
  }

  private isSearchParams(expr: Node | undefined): boolean {
    const e = expr ? unwrapExpression(expr) : undefined;
    if (!e) return false;
    if (Node.isIdentifier(e)) return this.searchParamAliases.has(e.getText());
    if (Node.isPropertyAccessExpression(e) && e.getName() === 'searchParams' && Node.isIdentifier(e.getExpression()) && this.urlAliases.has(e.getExpression().getText())) return true;
    const t = e.getText().replace(/\s/g, '');
    return t === `${this.req}.nextUrl.searchParams` || /^new URL\(.*\)\.searchParams$/.test(t.replace('newURL(', 'new URL(')) || /^newURL\(.*\)\.searchParams$/.test(t);
  }

  run() {
    // pass 1: aliases (const body = req.body / await req.json() / req.query; const { searchParams } = new URL(req.url))
    for (const d of this.fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const init = d.getInitializer();
      const target = d.getNameNode();
      const src = this.sourceOf(init);
      if (src && Node.isIdentifier(target)) this.aliases.set(target.getText(), src);
      if (init && Node.isIdentifier(target) && this.isSearchParams(init)) this.searchParamAliases.add(target.getText());
      if (init && Node.isIdentifier(target)) {
        const t = unwrapExpression(init)?.getText().replace(/\s/g, '') ?? '';
        if (/^newURL\(/.test(t) || t === `${this.req}.nextUrl`) this.urlAliases.add(target.getText());
      }
      if (init && Node.isObjectBindingPattern(target)) {
        const t = unwrapExpression(init)!;
        // const { searchParams } = new URL(req.url)
        if (/^newURL\(/.test(t.getText().replace(/\s/g, '')) || t.getText().replace(/\s/g, '') === `${this.req}.nextUrl`) {
          for (const el of target.getElements()) if ((el.getPropertyNameNode() ?? el.getNameNode()).getText() === 'searchParams') this.searchParamAliases.add(el.getNameNode().getText());
        }
        // const { body, query } = req
        if (t.getText() === this.req) {
          for (const el of target.getElements()) {
            const n = (el.getPropertyNameNode() ?? el.getNameNode()).getText();
            if ((n === 'body' || n === 'query' || n === 'params') && Node.isIdentifier(el.getNameNode())) this.aliases.set(el.getNameNode().getText(), n);
            else if ((n === 'body' || n === 'query' || n === 'params') && Node.isObjectBindingPattern(el.getNameNode())) {
              for (const f of fieldsOfPattern(el.getNameNode() as ObjectBindingPattern, n !== 'query')) this.add(n, f);
              this.note(`${this.req}.${n} destructuring`);
            }
          }
        }
      }
    }

    // pass 2: reads
    this.fn.forEachDescendant((n) => {
      if (Node.isPropertyAccessExpression(n) || Node.isElementAccessExpression(n)) this.propertyRead(n);
      else if (Node.isVariableDeclaration(n)) this.declaration(n);
      else if (Node.isCallExpression(n)) this.call(n);
      else if (Node.isAsExpression(n) || Node.isTypeAssertion(n) || Node.isSatisfiesExpression(n)) this.cast(n);
    });
  }

  private propertyRead(n: Node) {
    const access = n as import('ts-morph').PropertyAccessExpression | import('ts-morph').ElementAccessExpression;
    const base = Node.isPropertyAccessExpression(access) ? access.getExpression() : access.getExpression();
    const src = this.sourceOf(base);
    if (!src) return;
    let name: string | undefined;
    if (Node.isPropertyAccessExpression(access)) name = access.getName();
    else {
      const arg = unwrapExpression(access.getArgumentExpression());
      if (arg && (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg))) name = arg.getLiteralText();
    }
    if (!name || SAFE_PROPS.has(name)) return;
    // `req.body.items.length` etc. read deeper; only the first level is a field
    const parent = n.getParent();
    const optional = Node.isPropertyAccessExpression(access) && !!access.getQuestionDotTokenNode();
    this.add(src, { name, type: parent && Node.isCallExpression(parent) && parent.getExpression() === n ? 'unknown' : 'unknown', required: src !== 'query' && !optional });
    this.note(`${this.req}.${src} usage`);
  }

  private declaration(d: import('ts-morph').VariableDeclaration) {
    const init = d.getInitializer();
    const src = this.sourceOf(init);
    if (!src) return;
    const target = d.getNameNode();
    if (Node.isObjectBindingPattern(target)) {
      for (const f of fieldsOfPattern(target, src !== 'query')) this.add(src, f);
      this.note(`${this.req}.${src} destructuring`);
    }
    // const dto: CreateDto = req.body
    const typed = schemaFieldsOfType(this.ctx, d.getTypeNode());
    if (typed) {
      for (const f of typed) this.add(src, f);
      this.note(`${d.getTypeNode()!.getText()} (typed ${src})`);
    }
  }

  private cast(n: Node) {
    const e = n as import('ts-morph').AsExpression;
    const src = this.sourceOf(e.getExpression());
    if (!src) return;
    const typed = schemaFieldsOfType(this.ctx, e.getTypeNode());
    if (typed) {
      for (const f of typed) this.add(src, f);
      this.note(`${e.getTypeNode()!.getText()} (cast of ${src})`);
    }
  }

  private call(c: CallExpression) {
    const callee = unwrapExpression(c.getExpression());
    const args = c.getArguments();
    // searchParams.get('x') / getAll / has
    if (callee && Node.isPropertyAccessExpression(callee) && ['get', 'getAll', 'has'].includes(callee.getName()) && this.isSearchParams(callee.getExpression())) {
      const a = args[0] ? unwrapExpression(args[0]) : undefined;
      if (a && (Node.isStringLiteral(a) || Node.isNoSubstitutionTemplateLiteral(a))) {
        this.add('query', { name: a.getLiteralText(), type: callee.getName() === 'getAll' ? 'array' : 'string', required: false, ...(callee.getName() === 'getAll' ? { items: 'string' as const } : {}) });
        this.note('searchParams.get usage');
      }
      return;
    }
    // schema.parse(req.body) — zod
    if (callee && Node.isPropertyAccessExpression(callee) && /^(parse|safeParse|parseAsync|safeParseAsync)$/.test(callee.getName()) && args[0]) {
      const src = this.sourceOf(args[0]);
      const zf = src ? zodObjectFields(this.ctx, callee.getExpression()) : undefined;
      if (src && zf) {
        for (const f of zf) this.add(src, f);
        this.note(`zod schema (${src})`);
        return;
      }
    }
    // service.create(req.body): the callee's parameter type says what the body looks like
    args.forEach((a, i) => {
      const src = this.sourceOf(a);
      if (!src || !callee) return;
      const target = Node.isPropertyAccessExpression(callee) ? callee.getNameNode() : callee;
      if (!(Node.isIdentifier(target))) return;
      for (const d of this.ctx.resolve(target)) {
        if (!isFunctionLike(d) && !(Node.isVariableDeclaration(d))) continue;
        const fn = isFunctionLike(d) ? d : (() => { const init = d.getInitializer(); return init && isFunctionLike(unwrapExpression(init)!) ? (unwrapExpression(init) as FunctionLikeDeclaration) : undefined; })();
        const p = fn?.getParameters()[i];
        const typed = p ? schemaFieldsOfType(this.ctx, p.getTypeNode()) : undefined;
        if (typed) {
          for (const f of typed) this.add(src, f);
          this.note(`${p!.getTypeNode()!.getText()} (parameter of ${target.getText()})`);
          return;
        }
      }
    });
  }
}

/** Request schema inferred from how a handler reads its request. Undefined when it reads nothing identifiable. */
export function usageOfHandler(ctx: FileContext, fn: FunctionLikeDeclaration): RequestSchema | undefined {
  const p0 = fn.getParameters()[0];
  if (!p0) return undefined;
  const nameNode = p0.getNameNode();
  const typeText = p0.getTypeNode()?.getText() ?? '';
  const out = emptySchema();
  if (!Node.isIdentifier(nameNode)) return undefined;
  const req = nameNode.getText();
  if (!REQ_NAME.test(req) && !REQ_TYPE.test(typeText.replace(/<.*$/s, ''))) return undefined;

  const c = new Collector(ctx, fn, req);
  c.run();
  out.body = c.found.body;
  out.query = c.found.query;
  out.pathParams = c.found.params;
  out.sources = c.sources;
  // Request<Params, ResBody, ReqBody, ReqQuery>
  const gBody = genericFields(ctx, p0.getTypeNode(), 2);
  const gQuery = genericFields(ctx, p0.getTypeNode(), 3);
  const gParams = genericFields(ctx, p0.getTypeNode(), 0);
  if (gBody) {
    out.body = mergeFields(out.body, gBody);
    out.sources.push(`${typeText} (request body type)`);
  }
  if (gQuery) out.query = mergeFields(out.query, gQuery);
  if (gParams) out.pathParams = mergeFields(out.pathParams, gParams);
  // Next.js: second parameter `{ params }: { params: { id: string } }`
  const p1 = fn.getParameters()[1];
  if (p1 && Node.isObjectBindingPattern(p1.getNameNode()) && p1.getTypeNode()) {
    const t = schemaFieldsOfType(ctx, p1.getTypeNode());
    const params = t?.find((f) => f.name === 'params');
    if (params?.fields) out.pathParams = mergeFields(out.pathParams, params.fields);
  }
  return out.body.length || out.query.length || out.pathParams.length ? out : undefined;
}

function extract(ctx: FileContext): void {
  const usage: Record<string, RequestSchema> = {};
  for (const [node, id] of ctx.ownerByNode) {
    if (!isFunctionLike(node)) continue;
    // skip tiny callbacks without a request-like first parameter early: usageOfHandler checks the name/type
    const schema = usageOfHandler(ctx, node);
    if (schema) usage[id] = schema;
  }
  if (Object.keys(usage).length) ctx.facts.requestUsage = usage;
}

export const requestUsageAdapter: FrameworkAdapter = { name: 'request-usage', extract };
