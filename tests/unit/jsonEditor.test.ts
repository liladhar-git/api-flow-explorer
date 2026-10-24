import { describe, expect, it } from 'vitest';
import { parseLenientJson, normalizeLenient } from '../../src/types/jsonLenient';
import { applyEditorKey, type EditState } from '../../webview/src/state/jsonEditor';

const at = (value: string, caret = value.length, end = caret): EditState => ({ value, start: caret, end });

describe('lenient JSON', () => {
  it('formats strict JSON', () => {
    expect(parseLenientJson('{"a":[1,2],"b":{"c":null}}')).toMatchObject({ ok: true, text: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": null\n  }\n}' });
  });

  it('repairs JS-style literals: unquoted keys, single quotes, trailing commas, comments', () => {
    const r = parseLenientJson(`{
      // user
      name: 'Ann',
      "tags": ['a', "b",],   /* inline */
      nested: { ok: true, n: null, },
      quote: 'it\\'s "fine"',
    }`);
    expect(r).toMatchObject({ ok: true });
    expect((r as { value: unknown }).value).toEqual({ name: 'Ann', tags: ['a', 'b'], nested: { ok: true, n: null }, quote: `it's "fine"` });
  });

  it('accepts unquoted {{variables}} (substituted before sending) and keeps them when formatting', () => {
    const r = parseLenientJson('{"token": {{token}}, "ids": [{{a}}, {{b}}], "s": "{{inString}}", n: 1}');
    expect(r).toMatchObject({ ok: true });
    expect((r as { text: string }).text).toBe('{\n  "token": {{token}},\n  "ids": [\n    {{a}},\n    {{b}}\n  ],\n  "s": "{{inString}}",\n  "n": 1\n}');
    expect(parseLenientJson('{"a": {{x}} "b": 1}').ok).toBe(false); // still a real error: missing comma
    expect(parseLenientJson('{"a": {{unterminated}').ok).toBe(false);
  });

  it('does not touch text inside strings', () => {
    expect(normalizeLenient(`{"url":"http://x/y?a=1,b","c":"// not a comment","d":"key: value,"}`)).toBe(`{"url":"http://x/y?a=1,b","c":"// not a comment","d":"key: value,"}`);
  });

  it('reports line and column for real syntax errors (negative)', () => {
    const r = parseLenientJson('{\n  "a": 1\n  "b": 2\n}');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ line: 3 });
    expect(parseLenientJson('{"invalid": json syntax').ok).toBe(false);
    expect(parseLenientJson('').ok).toBe(false);
  });
});

describe('editor key rules', () => {
  it('auto-closes brackets and quotes and keeps the caret inside', () => {
    expect(applyEditorKey(at(''), '{')).toEqual({ value: '{}', start: 1, end: 1 });
    expect(applyEditorKey(at('[', 1), '[')).toEqual({ value: '[[]', start: 2, end: 2 });
    expect(applyEditorKey(at(''), '"')).toEqual({ value: '""', start: 1, end: 1 });
  });

  it('types over an existing closer instead of duplicating it', () => {
    expect(applyEditorKey(at('{}', 1), '}')).toEqual({ value: '{}', start: 2, end: 2 });
    expect(applyEditorKey(at('""', 1), '"')).toEqual({ value: '""', start: 2, end: 2 });
  });

  it('wraps a selection and does not auto-close a quote inside a word', () => {
    expect(applyEditorKey(at('abc', 0, 3), '"')).toEqual({ value: '"abc"', start: 1, end: 4 });
    expect(applyEditorKey(at('it', 2), '"')).toBeNull();
  });

  it('Enter between braces opens an indented block; otherwise keeps the indentation', () => {
    expect(applyEditorKey(at('{}', 1), 'Enter')).toEqual({ value: '{\n  \n}', start: 4, end: 4 });
    expect(applyEditorKey(at('  "a": 1', 8), 'Enter')).toEqual({ value: '  "a": 1\n  ', start: 11, end: 11 });
    expect(applyEditorKey(at('  {', 3), 'Enter')).toEqual({ value: '  {\n    ', start: 8, end: 8 });
    expect(applyEditorKey(at('  {}', 3), 'Enter')).toEqual({ value: '  {\n    \n  }', start: 8, end: 8 });
  });

  it('Tab inserts two spaces; with a selection it indents/outdents whole lines', () => {
    expect(applyEditorKey(at('a', 1), 'Tab')).toEqual({ value: 'a  ', start: 3, end: 3 });
    expect(applyEditorKey(at('x\ny', 0, 3), 'Tab')).toMatchObject({ value: '  x\n  y' });
    expect(applyEditorKey(at('  x\n  y', 0, 7), 'Tab', true)).toMatchObject({ value: 'x\ny' });
  });

  it('Backspace removes an empty pair; other keys fall through', () => {
    expect(applyEditorKey(at('{}', 1), 'Backspace')).toEqual({ value: '', start: 0, end: 0 });
    expect(applyEditorKey(at('{a}', 2), 'Backspace')).toBeNull();
    expect(applyEditorKey(at('a', 1), 'x')).toBeNull();
  });
});
