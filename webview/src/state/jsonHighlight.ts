/** Tokenizer for the request/response code views. Tolerant: understands comments, single quotes, unquoted keys and `{{variables}}`. */
export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'bracket' | 'comment' | 'variable' | 'text';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  /** Nesting depth for brackets (0-based), used for bracket-pair colours. */
  depth?: number;
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const LITERAL = /^(?:true|false|null)\b/;
const IDENT = /^[A-Za-z_$][\w$]*/;

function nextSignificant(text: string, from: number): string {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i])) i++;
    else if (text.startsWith('/*', i)) {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? text.length : e + 2;
    } else if (text.startsWith('//', i)) {
      const e = text.indexOf('\n', i);
      i = e < 0 ? text.length : e;
    } else break;
  }
  return text[i] ?? '';
}

export function tokenizeJson(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let depth = 0;
  let plain = '';
  let plainStart = 0;
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain, start: plainStart });
    plain = '';
  };
  const push = (kind: TokenKind, end: number, extra: Partial<Token> = {}) => {
    flush();
    out.push({ kind, text: text.slice(i, end), start: i, ...extra });
    i = end;
    plainStart = i;
  };
  while (i < text.length) {
    const c = text[i];
    if (text.startsWith('{{', i)) {
      const e = text.indexOf('}}', i + 2);
      const line = text.indexOf('\n', i);
      if (e >= 0 && (line < 0 || e < line)) {
        push('variable', e + 2);
        continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(text[j] === c ? j + 1 : j, text.length);
      push(nextSignificant(text, end) === ':' ? 'key' : 'string', end);
    } else if (text.startsWith('//', i)) {
      const e = text.indexOf('\n', i);
      push('comment', e < 0 ? text.length : e);
    } else if (text.startsWith('/*', i)) {
      const e = text.indexOf('*/', i + 2);
      push('comment', e < 0 ? text.length : e + 2);
    } else if (c === '{' || c === '[') {
      push('bracket', i + 1, { depth: depth++ });
    } else if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1);
      push('bracket', i + 1, { depth });
    } else if (c === ',' || c === ':') {
      push('punct', i + 1);
    } else if ((c === '-' || (c >= '0' && c <= '9')) && NUMBER.test(text.slice(i, i + 40))) {
      push('number', i + NUMBER.exec(text.slice(i, i + 40))![0].length);
    } else if (IDENT.test(text.slice(i, i + 80))) {
      const word = IDENT.exec(text.slice(i, i + 80))![0];
      const end = i + word.length;
      if (nextSignificant(text, end) === ':') push('key', end);
      else if (LITERAL.test(word)) push('literal', end);
      else {
        if (!plain) plainStart = i;
        plain += word;
        i = end;
      }
    } else {
      if (!plain) plainStart = i;
      plain += c;
      i++;
    }
  }
  flush();
  return out;
}

/** Index of the bracket matching the one at `index` (either direction), or -1. Strings/comments are ignored via the tokens. */
export function matchingBracket(tokens: Token[], index: number): number {
  const brackets = tokens.filter((t) => t.kind === 'bracket');
  const stack: Token[] = [];
  const pairs = new Map<number, number>();
  for (const b of brackets) {
    if (b.text === '{' || b.text === '[') stack.push(b);
    else {
      const open = stack[stack.length - 1];
      if (open && ((open.text === '{' && b.text === '}') || (open.text === '[' && b.text === ']'))) {
        stack.pop();
        pairs.set(open.start, b.start);
        pairs.set(b.start, open.start);
      }
    }
  }
  return pairs.get(index) ?? -1;
}

/** 0-based line and column of a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return { line, column: offset - (before.lastIndexOf('\n') + 1) };
}
