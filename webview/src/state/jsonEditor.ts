/** Pure editing rules for the request-body textarea (so they can be unit-tested without a DOM). */
export interface EditState {
  value: string;
  start: number;
  end: number;
}

const PAIRS: Record<string, string> = { '{': '}', '[': ']', '"': '"' };
const INDENT = '  ';

function lineStart(value: string, pos: number): number {
  return value.lastIndexOf('\n', pos - 1) + 1;
}

/**
 * Applies editor behaviour for a key press: Tab/Shift+Tab indentation, smart Enter, bracket and quote auto-close,
 * skipping over an already-typed closer, and deleting an empty pair with Backspace. Returns null when the browser's
 * default behaviour is right.
 */
export function applyEditorKey(s: EditState, key: string, shift = false): EditState | null {
  const { value, start, end } = s;
  const before = value.slice(0, start);
  const after = value.slice(end);
  const selected = value.slice(start, end);

  if (key === 'Tab') {
    if (start === end && !shift) return { value: before + INDENT + after, start: start + INDENT.length, end: start + INDENT.length };
    // indent / outdent every line the selection touches
    const from = lineStart(value, start);
    const block = value.slice(from, end);
    const lines = block.split('\n');
    const changed = lines.map((l) => (shift ? l.replace(/^ {1,2}|^\t/, '') : INDENT + l));
    const delta = changed.join('\n').length - block.length;
    const firstDelta = changed[0].length - lines[0].length;
    return { value: value.slice(0, from) + changed.join('\n') + value.slice(end), start: Math.max(from, start + firstDelta), end: end + delta };
  }

  if (key === 'Enter' && start === end) {
    const ls = lineStart(value, start);
    const indent = /^[ \t]*/.exec(value.slice(ls, start))![0];
    const prev = value[start - 1];
    const next = value[start];
    if ((prev === '{' && next === '}') || (prev === '[' && next === ']')) {
      const inner = indent + INDENT;
      const text = `\n${inner}\n${indent}`;
      return { value: before + text + after, start: start + 1 + inner.length, end: start + 1 + inner.length };
    }
    const extra = prev === '{' || prev === '[' ? INDENT : '';
    const ins = '\n' + indent + extra;
    return { value: before + ins + after, start: start + ins.length, end: start + ins.length };
  }

  if (key in PAIRS) {
    const close = PAIRS[key];
    if (start !== end) return { value: before + key + selected + close + after, start: start + 1, end: end + 1 }; // wrap selection
    if (key === '"' && value[start] === '"') return { value, start: start + 1, end: start + 1 }; // step over the closing quote
    if (key === '"' && /[\w"\\]/.test(value[start - 1] ?? '')) return null; // inside a word or after an escape: plain quote
    return { value: before + key + close + after, start: start + 1, end: start + 1 };
  }

  if ((key === '}' || key === ']') && start === end && value[start] === key) return { value, start: start + 1, end: start + 1 };

  if (key === 'Backspace' && start === end && start > 0) {
    const open = value[start - 1];
    if (open in PAIRS && value[start] === PAIRS[open]) return { value: value.slice(0, start - 1) + value.slice(start + 1), start: start - 1, end: start - 1 };
  }
  return null;
}
