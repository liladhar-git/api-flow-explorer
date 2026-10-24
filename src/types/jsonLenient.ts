/**
 * Tolerant JSON for hand-written request bodies: accepts what people paste from JavaScript or docs — comments,
 * trailing commas, single-quoted strings and unquoted keys — and turns it into strict JSON. Pure (no DOM, no VS Code).
 */
export type JsonResult = { ok: true; value: unknown; text: string } | { ok: false; error: string; line?: number; column?: number };

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[\w$]/;

const VAR_OPEN = '\uE000VAR';
const VAR_CLOSE = '\uE001'; // private-use characters: valid inside JSON strings, never typed by users

/**
 * Rewrites lenient syntax to strict JSON text without validating the structure. When `vars` is given, an unquoted
 * `{{variable}}` (substituted by the API tester before sending) is replaced by a placeholder string and recorded there.
 */
export function normalizeLenient(input: string, vars?: string[]): string {
  let out = '';
  let i = 0;
  const n = input.length;
  const nextSignificant = (from: number): string => {
    let j = from;
    while (j < n) {
      if (/\s/.test(input[j])) j++;
      else if (input[j] === '/' && input[j + 1] === '/') j = input.indexOf('\n', j) < 0 ? n : input.indexOf('\n', j);
      else if (input[j] === '/' && input[j + 1] === '*') j = input.indexOf('*/', j + 2) < 0 ? n : input.indexOf('*/', j + 2) + 2;
      else break;
    }
    return input[j] ?? '';
  };
  while (i < n) {
    const c = input[i];
    if (vars && c === '{' && input[i + 1] === '{') {
      const end = input.indexOf('}}', i + 2);
      const nl = input.indexOf('\n', i);
      if (end >= 0 && (nl < 0 || end < nl)) {
        out += `"${VAR_OPEN}${vars.length}${VAR_CLOSE}"`;
        vars.push(input.slice(i, end + 2));
        i = end + 2;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < n && input[i] !== c) {
        if (input[i] === '\\' && i + 1 < n) {
          const e = input[i + 1];
          s += e === "'" ? "'" : '\\' + e;
          i += 2;
        } else {
          s += input[i] === '"' ? '\\"' : input[i] === '\n' ? '\\n' : input[i];
          i++;
        }
      }
      i++;
      out += `"${s}"`;
    } else if (c === '/' && input[i + 1] === '/') {
      while (i < n && input[i] !== '\n') i++;
    } else if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === ',' && /[}\]]/.test(nextSignificant(i + 1))) {
      i++; // trailing comma
    } else if (IDENT_START.test(c)) {
      let j = i;
      while (j < n && IDENT.test(input[j])) j++;
      const word = input.slice(i, j);
      out += nextSignificant(j) === ':' && !/^(true|false|null)$/.test(word) ? `"${word}"` : word;
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function position(text: string, message: string): { line?: number; column?: number } {
  const m = /position (\d+)/.exec(message);
  if (!m) return {};
  const pos = Number(m[1]);
  const before = text.slice(0, pos).split('\n');
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** Strict parse first; on failure, try the lenient rewrite. `text` is pretty-printed with 2 spaces. */
export function parseLenientJson(input: string): JsonResult {
  try {
    const value = JSON.parse(input);
    return { ok: true, value, text: JSON.stringify(value, null, 2) };
  } catch (strictErr) {
    const vars: string[] = [];
    const normalized = normalizeLenient(input, vars);
    try {
      const value = JSON.parse(normalized);
      // put the `{{variables}}` back, unquoted, exactly as the user wrote them
      const text = JSON.stringify(value, null, 2).replace(new RegExp(`"${VAR_OPEN}(\\d+)${VAR_CLOSE}"`, 'g'), (_, n) => vars[Number(n)] ?? '');
      return { ok: true, value, text };
    } catch (e) {
      const msg = (strictErr as Error).message;
      return { ok: false, error: msg.replace(/^JSON\.parse: /, ''), ...position(input, msg) };
    }
  }
}
