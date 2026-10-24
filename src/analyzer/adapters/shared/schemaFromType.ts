import { Node, SyntaxKind, type ClassDeclaration, type InterfaceDeclaration, type TypeNode } from 'ts-morph';
import { MAX_FIELDS_PER_LEVEL, MAX_SCHEMA_DEPTH, type FieldSchema, type FieldType } from '../../../types/requestSchema';
import type { FileContext } from '../../fileContext';
import { moduleRef } from '../../importResolver';
import { unwrapExpression } from '../../symbolResolver';

/** Types that are scalars on the wire even though they are written as references. */
const STRING_LIKE = new Set(['Date', 'ObjectId', 'Types.ObjectId', 'Buffer', 'UUID', 'Decimal', 'Decimal128', 'BigInt']);
const OPAQUE = new Set(['any', 'unknown', 'object', 'Object', 'Record', 'Map', 'JSON', 'FormData', 'File', 'Blob', 'Express.Multer.File']);

interface Walk {
  ctx: FileContext;
  depth: number;
  seen: Set<string>;
}

const key = (n: Node) => `${n.getSourceFile().getFilePath()}:${n.getPos()}`;

const stripNullish = (t: TypeNode): { node: TypeNode; optional: boolean } => {
  if (Node.isUnionTypeNode(t)) {
    const kept = t.getTypeNodes().filter((x) => !/^(null|undefined)$/.test(x.getText()));
    if (kept.length === 1 && kept.length < t.getTypeNodes().length) return { node: kept[0], optional: true };
  }
  return { node: t, optional: false };
};

function literalOf(t: TypeNode): string | number | undefined {
  if (Node.isLiteralTypeNode(t)) {
    const l = t.getLiteral();
    if (Node.isStringLiteral(l) || Node.isNoSubstitutionTemplateLiteral(l)) return l.getLiteralText();
    if (Node.isNumericLiteral(l)) return Number(l.getText());
  }
  return undefined;
}

/** Field description for one named member given its declared type. */
export function fieldOfType(ctx: FileContext, name: string, type: TypeNode | undefined, required: boolean, w: Walk): FieldSchema {
  if (!type) return { name, type: 'unknown', required };
  const { node: t, optional } = stripNullish(type);
  const req = required && !optional;
  const text = t.getText();

  // 'a' | 'b'  →  enum
  if (Node.isUnionTypeNode(t)) {
    const lits = t.getTypeNodes().map(literalOf);
    if (lits.length && lits.every((l) => l !== undefined)) return { name, type: typeof lits[0] === 'number' ? 'number' : 'string', required: req, enumValues: lits as (string | number)[] };
    return { name, type: 'unknown', required: req };
  }
  const lit = literalOf(t);
  if (lit !== undefined) return { name, type: typeof lit === 'number' ? 'number' : 'string', required: req, example: lit };
  if (Node.isArrayTypeNode(t)) return arrayField(ctx, name, t.getElementTypeNode(), req, w);
  if (Node.isTupleTypeNode(t)) return { name, type: 'array', required: req, items: 'unknown' };
  if (Node.isTypeLiteral(t)) return objectField(name, req, fieldsOfMembers(t.getMembers(), w), w);
  if (Node.isParenthesizedTypeNode(t)) return fieldOfType(ctx, name, t.getTypeNode(), req, w);
  if (Node.isIntersectionTypeNode(t)) {
    const fields = t.getTypeNodes().flatMap((x) => fieldsOfType(x, w) ?? []);
    return fields.length ? objectField(name, req, fields, w) : { name, type: 'object', required: req };
  }
  if (t.getKind() === SyntaxKind.StringKeyword || t.getKind() === SyntaxKind.TemplateLiteralType) return { name, type: 'string', required: req };
  if (t.getKind() === SyntaxKind.NumberKeyword || t.getKind() === SyntaxKind.BigIntKeyword) return { name, type: 'number', required: req };
  if (t.getKind() === SyntaxKind.BooleanKeyword) return { name, type: 'boolean', required: req };
  if (Node.isTypeReference(t)) {
    const tn = t.getTypeName().getText();
    const base = tn.replace(/^.*\./, '');
    const args = t.getTypeArguments();
    if (STRING_LIKE.has(tn) || STRING_LIKE.has(base)) return { name, type: 'string', required: req };
    if (/^(Array|ReadonlyArray|Set)$/.test(base) && args[0]) return arrayField(ctx, name, args[0], req, w);
    if (OPAQUE.has(tn) || OPAQUE.has(base)) return { name, type: 'object', required: req };
    if (/^(Partial|Required|Readonly|Pick|Omit)$/.test(base) && args[0]) {
      const fields = fieldsOfType(t, w);
      return fields ? objectField(name, req, fields, w) : { name, type: 'object', required: req };
    }
    const resolved = declarationOf(ctx, t.getTypeName());
    if (resolved && Node.isEnumDeclaration(resolved)) {
      const values = resolved.getMembers().flatMap((m): (string | number)[] => {
        const init = m.getInitializer();
        if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) return [init.getLiteralText()];
        if (init && Node.isNumericLiteral(init)) return [Number(init.getText())];
        return typeof m.getValue() === 'number' ? [m.getValue() as number] : [];
      });
      return { name, type: typeof values[0] === 'number' ? 'number' : 'string', required: req, enumValues: values };
    }
    if (resolved && Node.isTypeAliasDeclaration(resolved) && resolved.getTypeNode()) {
      const inner = resolved.getTypeNode()!;
      if (!w.seen.has(key(resolved))) {
        const seen = new Set(w.seen).add(key(resolved));
        return { ...fieldOfType(ctx, name, inner, req, { ...w, seen }), name };
      }
    }
    const fields = fieldsOfType(t, w);
    if (fields) return objectField(name, req, fields, w);
    return { name, type: 'unknown', required: req };
  }
  void text;
  return { name, type: 'unknown', required: req };
}

function arrayField(ctx: FileContext, name: string, element: TypeNode, required: boolean, w: Walk): FieldSchema {
  const el = fieldOfType(ctx, name, element, true, { ...w, depth: w.depth + 1 });
  return { name, type: 'array', required, items: el.type, ...(el.type === 'object' && el.fields?.length ? { fields: el.fields } : {}) };
}

function objectField(name: string, required: boolean, fields: FieldSchema[], w: Walk): FieldSchema {
  return { name, type: 'object', required, ...(w.depth < MAX_SCHEMA_DEPTH && fields.length ? { fields } : {}) };
}

function declarationOf(ctx: FileContext, name: Node): Node | undefined {
  return ctx.resolve(name).find((d) => Node.isClassDeclaration(d) || Node.isInterfaceDeclaration(d) || Node.isEnumDeclaration(d) || Node.isTypeAliasDeclaration(d));
}

function fieldsOfMembers(members: Node[], w: Walk): FieldSchema[] {
  const out: FieldSchema[] = [];
  for (const m of members) {
    if (!Node.isPropertySignature(m)) continue;
    const nameNode = m.getNameNode();
    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
    if (!name) continue;
    out.push(fieldOfType(w.ctx, name, m.getTypeNode(), !m.hasQuestionToken(), { ...w, depth: w.depth + 1 }));
    if (out.length >= MAX_FIELDS_PER_LEVEL) break;
  }
  return out;
}

/** Declared example from `@ApiProperty({ example })`, or a sensible one implied by a class-validator decorator. */
function decoratorHints(ctx: FileContext, prop: Node): { optional: boolean; example?: string | number | boolean; enumValues?: (string | number)[]; type?: FieldType } {
  const hints: ReturnType<typeof decoratorHints> = { optional: false };
  if (!Node.isDecoratable(prop)) return hints;
  for (const d of prop.getDecorators()) {
    const ref = moduleRef(d.getNameNode());
    const name = ref?.member ?? d.getName();
    const arg = d.getArguments()[0] ? unwrapExpression(d.getArguments()[0]) : undefined;
    if (name === 'IsOptional') hints.optional = true;
    else if (name === 'IsEmail') hints.example ??= 'name@example.com';
    else if (name === 'IsUrl') hints.example ??= 'https://example.com';
    else if (name === 'IsUUID') hints.example ??= '00000000-0000-4000-8000-000000000000';
    else if (name === 'IsString' || name === 'IsNotEmpty' || name === 'MinLength' || name === 'MaxLength') hints.type ??= 'string';
    else if (name === 'IsNumber' || name === 'IsInt' || name === 'IsPositive') hints.type ??= 'number';
    else if (name === 'IsBoolean') hints.type ??= 'boolean';
    else if (name === 'IsArray') hints.type ??= 'array';
    else if (name === 'IsIn' && arg && Node.isArrayLiteralExpression(arg)) {
      hints.enumValues = arg.getElements().flatMap((e): (string | number)[] => (Node.isStringLiteral(e) ? [e.getLiteralText()] : Node.isNumericLiteral(e) ? [Number(e.getText())] : []));
    } else if (name === 'IsEnum' && arg && (Node.isIdentifier(arg) || Node.isPropertyAccessExpression(arg))) {
      const en = ctx.resolve(Node.isPropertyAccessExpression(arg) ? arg.getNameNode() : arg).find((x) => Node.isEnumDeclaration(x));
      if (en && Node.isEnumDeclaration(en)) hints.enumValues = en.getMembers().flatMap((m): (string | number)[] => (typeof m.getValue() === 'undefined' ? [] : [m.getValue() as string | number]));
    } else if ((name === 'ApiProperty' || name === 'ApiPropertyOptional') && arg && Node.isObjectLiteralExpression(arg)) {
      if (name === 'ApiPropertyOptional') hints.optional = true;
      const req = arg.getProperty('required');
      if (req && Node.isPropertyAssignment(req) && req.getInitializer()?.getText() === 'false') hints.optional = true;
      const ex = arg.getProperty('example');
      const init = ex && Node.isPropertyAssignment(ex) ? unwrapExpression(ex.getInitializer()) : undefined;
      if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) hints.example = init.getLiteralText();
      else if (init && Node.isNumericLiteral(init)) hints.example = Number(init.getText());
      else if (init && (init.getText() === 'true' || init.getText() === 'false')) hints.example = init.getText() === 'true';
    }
  }
  return hints;
}

function fieldsOfClass(cls: ClassDeclaration, w: Walk): FieldSchema[] {
  const k = key(cls);
  if (w.seen.has(k) || w.depth > MAX_SCHEMA_DEPTH) return [];
  const seen = new Set(w.seen).add(k);
  const walk = { ...w, seen };
  w.ctx.touch(cls);

  // inheritance: `extends Base`, `extends PartialType(Dto)`, `OmitType(Dto, ['a'])`, `PickType`, `IntersectionType` (nestable)
  const ext = cls.getExtends()?.getExpression();
  let fields: FieldSchema[] = ext ? fieldsOfHeritage(ext, walk) : [];

  for (const p of cls.getProperties()) {
    if (p.isStatic() || p.hasModifier(SyntaxKind.PrivateKeyword) || p.hasModifier(SyntaxKind.ProtectedKeyword)) continue;
    const nameNode = p.getNameNode();
    const name = Node.isStringLiteral(nameNode) ? nameNode.getLiteralText() : Node.isIdentifier(nameNode) ? nameNode.getText() : undefined;
    if (!name) continue;
    const hints = decoratorHints(w.ctx, p);
    const required = !p.hasQuestionToken() && !hints.optional && !p.getInitializer();
    let f = fieldOfType(w.ctx, name, p.getTypeNode(), required, { ...walk, depth: w.depth + 1 });
    if (f.type === 'unknown' && hints.type) f = { ...f, type: hints.type };
    const init = p.getInitializer() ? unwrapExpression(p.getInitializer()) : undefined;
    if (init && f.example === undefined) {
      if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) f = { ...f, type: f.type === 'unknown' ? 'string' : f.type, example: init.getLiteralText() };
      else if (Node.isNumericLiteral(init)) f = { ...f, type: f.type === 'unknown' ? 'number' : f.type, example: Number(init.getText()) };
      else if (init.getText() === 'true' || init.getText() === 'false') f = { ...f, type: f.type === 'unknown' ? 'boolean' : f.type, example: init.getText() === 'true' };
    }
    if (hints.enumValues) f = { ...f, enumValues: hints.enumValues, type: typeof hints.enumValues[0] === 'number' ? 'number' : f.type === 'unknown' ? 'string' : f.type };
    if (hints.example !== undefined && f.example === undefined) f = { ...f, example: hints.example };
    fields = fields.filter((x) => x.name !== name);
    fields.push(f);
    if (fields.length >= MAX_FIELDS_PER_LEVEL) break;
  }
  return fields;
}

/** Fields contributed by an `extends` expression: a class, or (possibly nested) @nestjs/mapped-types helpers. */
function fieldsOfHeritage(expr: Node, w: Walk): FieldSchema[] {
  const e = unwrapExpression(expr);
  if (!e) return [];
  if (Node.isCallExpression(e)) {
    const fn = e.getExpression().getText().replace(/^.*\./, '');
    const [first, second] = e.getArguments();
    const listArg = second ? unwrapExpression(second) : undefined;
    const names = listArg && Node.isArrayLiteralExpression(listArg) ? listArg.getElements().flatMap((x) => (Node.isStringLiteral(x) ? [x.getLiteralText()] : [])) : [];
    let base = first ? fieldsOfHeritage(first, w) : [];
    if (fn === 'PartialType') base = base.map((f) => ({ ...f, required: false }));
    else if (fn === 'OmitType') base = base.filter((f) => !names.includes(f.name));
    else if (fn === 'PickType') base = base.filter((f) => names.includes(f.name));
    else if (fn === 'IntersectionType' && second) base = [...base, ...fieldsOfHeritage(second, w)];
    else if (!/^(PartialType|OmitType|PickType|IntersectionType)$/.test(fn)) return [];
    return base;
  }
  if (Node.isIdentifier(e) || Node.isPropertyAccessExpression(e)) {
    const d = w.ctx.resolve(Node.isPropertyAccessExpression(e) ? e.getNameNode() : e).find((x) => Node.isClassDeclaration(x));
    if (d && Node.isClassDeclaration(d)) return fieldsOfClass(d, w);
  }
  return [];
}

function fieldsOfInterface(decl: InterfaceDeclaration, w: Walk): FieldSchema[] {
  const k = key(decl);
  if (w.seen.has(k) || w.depth > MAX_SCHEMA_DEPTH) return [];
  const walk = { ...w, seen: new Set(w.seen).add(k) };
  w.ctx.touch(decl);
  let fields: FieldSchema[] = [];
  for (const h of decl.getExtends()) {
    const d = w.ctx.resolve(h.getExpression()).find((x) => Node.isInterfaceDeclaration(x));
    if (d && Node.isInterfaceDeclaration(d)) fields = [...fields, ...fieldsOfInterface(d, walk)];
  }
  return [...fields.filter((f) => !decl.getProperty(f.name)), ...fieldsOfMembers(decl.getMembers(), walk)];
}

/**
 * Fields of an object-like type: type literals, interfaces, classes, type aliases and the utility types
 * Partial/Required/Pick/Omit/Readonly. Undefined when the type is not an object shape we can read.
 */
export function fieldsOfType(type: TypeNode | undefined, w: Walk): FieldSchema[] | undefined {
  if (!type) return undefined;
  const { node: t } = stripNullish(type);
  if (Node.isTypeLiteral(t)) return fieldsOfMembers(t.getMembers(), w);
  if (Node.isParenthesizedTypeNode(t)) return fieldsOfType(t.getTypeNode(), w);
  if (Node.isIntersectionTypeNode(t)) return t.getTypeNodes().flatMap((x) => fieldsOfType(x, w) ?? []);
  if (Node.isArrayTypeNode(t)) return undefined;
  if (!Node.isTypeReference(t)) return undefined;
  const base = t.getTypeName().getText().replace(/^.*\./, '');
  const args = t.getTypeArguments();
  if (/^(Partial|Required|Readonly|Pick|Omit)$/.test(base) && args[0]) {
    const inner = fieldsOfType(args[0], w) ?? [];
    const names = args[1] ? (Node.isUnionTypeNode(args[1]) ? args[1].getTypeNodes() : [args[1]]).map(literalOf).filter((x): x is string => typeof x === 'string') : [];
    if (base === 'Partial') return inner.map((f) => ({ ...f, required: false }));
    if (base === 'Required') return inner.map((f) => ({ ...f, required: true }));
    if (base === 'Pick') return inner.filter((f) => names.includes(f.name));
    if (base === 'Omit') return inner.filter((f) => !names.includes(f.name));
    return inner;
  }
  if (OPAQUE.has(base) || STRING_LIKE.has(base)) return undefined;
  const decl = declarationOf(w.ctx, t.getTypeName());
  if (!decl) return undefined;
  if (Node.isClassDeclaration(decl)) return fieldsOfClass(decl, w);
  if (Node.isInterfaceDeclaration(decl)) return fieldsOfInterface(decl, w);
  if (Node.isTypeAliasDeclaration(decl) && decl.getTypeNode() && !w.seen.has(key(decl))) {
    return fieldsOfType(decl.getTypeNode(), { ...w, seen: new Set(w.seen).add(key(decl)) });
  }
  return undefined;
}

/** Entry point: fields of a type annotation, starting a fresh walk. */
export function schemaFieldsOfType(ctx: FileContext, type: TypeNode | undefined): FieldSchema[] | undefined {
  const fields = fieldsOfType(type, { ctx, depth: 0, seen: new Set() });
  return fields && fields.length ? fields.slice(0, MAX_FIELDS_PER_LEVEL) : undefined;
}

/** A single field from a type annotation (e.g. `@Query('page') page: number`). */
export function schemaFieldOfType(ctx: FileContext, name: string, type: TypeNode | undefined, required: boolean): FieldSchema {
  return fieldOfType(ctx, name, type, required, { ctx, depth: 0, seen: new Set() });
}
