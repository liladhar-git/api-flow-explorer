import { describe, expect, it } from 'vitest';
import { lineColumn, matchingBracket, tokenizeJson } from '../../webview/src/state/jsonHighlight';

const kinds = (s: string) => tokenizeJson(s).filter((t) => t.kind !== 'text').map((t) => `${t.kind}:${t.text}`);

describe('tokenizeJson', () => {
  it('classifies keys, strings, numbers, literals, punctuation and brackets', () => {
    expect(kinds('{"a": "x", "n": -1.5e3, "ok": true, "z": null}')).toEqual([
      'bracket:{', 'key:"a"', 'punct::', 'string:"x"', 'punct:,', 'key:"n"', 'punct::', 'number:-1.5e3', 'punct:,', 'key:"ok"', 'punct::', 'literal:true', 'punct:,', 'key:"z"', 'punct::', 'literal:null', 'bracket:}',
    ]);
  });

  it('tokens cover the text exactly, in order (so the highlight layer lines up with the textarea)', () => {
    for (const src of ['{\n  "a": [1, 2, {"b": "c\\"d"}],\n  // note\n  x: \'s\', /* c */ "u": {{token}}\n}', '', '   ', 'plain text 123 true', '{"unterminated: 1', '/* open']) {
      expect(tokenizeJson(src).map((t) => t.text).join('')).toBe(src);
      let pos = 0;
      for (const t of tokenizeJson(src)) {
        expect(t.start).toBe(pos);
        pos += t.text.length;
      }
    }
  });

  it('understands JS-style input and request variables', () => {
    expect(kinds("{ id: 7, 'name': 'x', // c\n ok: false, tok: {{token}} }")).toEqual([
      'bracket:{', 'key:id', 'punct::', 'number:7', 'punct:,', "key:'name'", 'punct::', "string:'x'", 'punct:,', 'comment:// c', 'key:ok', 'punct::', 'literal:false', 'punct:,', 'key:tok', 'punct::', 'variable:{{token}}', 'bracket:}',
    ]);
  });

  it('does not colour words inside strings or numbers inside identifiers', () => {
    expect(kinds('{"a": "true 12 {"}')).toEqual(['bracket:{', 'key:"a"', 'punct::', 'string:"true 12 {"', 'bracket:}']);
    expect(kinds('abc123')).toEqual([]);
  });

  it('assigns bracket depth for pair colouring', () => {
    const d = tokenizeJson('[{"a":[1]}]').filter((t) => t.kind === 'bracket').map((t) => `${t.text}${t.depth}`);
    expect(d).toEqual(['[0', '{1', '[2', ']2', '}1', ']0']);
  });
});

describe('matchingBracket / lineColumn', () => {
  const src = '{\n  "a": [1, "]"],\n  "b": {}\n}';
  const tokens = tokenizeJson(src);
  it('pairs brackets in both directions and ignores brackets inside strings', () => {
    expect(matchingBracket(tokens, 0)).toBe(src.length - 1);
    expect(matchingBracket(tokens, src.length - 1)).toBe(0);
    const open = src.indexOf('[');
    expect(matchingBracket(tokens, open)).toBe(src.indexOf('"]"') + 3);
  });
  it('returns -1 for unmatched or non-bracket positions', () => {
    expect(matchingBracket(tokenizeJson('{ [ }'), 0)).toBe(-1);
    expect(matchingBracket(tokens, 3)).toBe(-1);
  });
  it('converts offsets to line/column', () => {
    expect(lineColumn(src, 0)).toEqual({ line: 0, column: 0 });
    expect(lineColumn(src, src.indexOf('"b"'))).toEqual({ line: 2, column: 2 });
  });
});
