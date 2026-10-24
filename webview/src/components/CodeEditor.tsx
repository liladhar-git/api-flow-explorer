import { forwardRef, useMemo, useRef, useState, type ClipboardEventHandler, type FocusEventHandler, type KeyboardEventHandler } from 'react';
import { lineColumn, matchingBracket, tokenizeJson } from '../state/jsonHighlight';

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  language: 'json' | 'text';
  /** 1-based line to mark as erroneous. */
  errorLine?: number;
  placeholder?: string;
  ariaLabel: string;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
}

/** Colourised token spans; shared by the editable editor and the read-only response view. */
export function HighlightedCode({ text, language }: { text: string; language: 'json' | 'text' }) {
  const tokens = useMemo(() => (language === 'json' ? tokenizeJson(text) : [{ kind: 'text' as const, text, start: 0 }]), [text, language]);
  return (
    <>
      {tokens.map((t) => (
        <span key={t.start} className={`tok tok-${t.kind}${t.kind === 'bracket' ? ` bracket-${(t.depth ?? 0) % 3}` : ''}`}>
          {t.text}
        </span>
      ))}
    </>
  );
}

/**
 * A code editor built on a plain textarea: the textarea receives all input (so editing, undo and IME work natively)
 * and a highlighted copy of the text is drawn behind it. Adds line numbers, current-line and error-line highlight,
 * bracket-pair colours and matching-bracket highlight. Content is rendered as React text, never as HTML.
 */
export const CodeEditor = forwardRef<HTMLTextAreaElement, CodeEditorProps>(function CodeEditor(
  { value, onChange, language, errorLine, placeholder, ariaLabel, onKeyDown, onPaste, onBlur },
  ref,
) {
  const layerRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const lines = useMemo(() => value.split('\n').length, [value]);
  const tokens = useMemo(() => (language === 'json' ? tokenizeJson(value) : []), [value, language]);

  const syncScroll = (el: HTMLTextAreaElement) => {
    if (layerRef.current) layerRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
  };

  const current = lineColumn(value, caret);
  // the bracket at the caret (or just before it) and its partner
  const brackets: { line: number; column: number }[] = [];
  if (language === 'json') {
    for (const pos of [caret, caret - 1]) {
      const t = tokens.find((x) => x.kind === 'bracket' && x.start === pos);
      if (!t) continue;
      const m = matchingBracket(tokens, t.start);
      if (m >= 0) brackets.push(lineColumn(value, t.start), lineColumn(value, m));
      break;
    }
  }

  return (
    <div className="code-editor" data-language={language}>
      <div className="code-gutter" aria-hidden="true">
        <div ref={gutterRef} className="code-gutter-inner">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={`code-ln${i === current.line ? ' active' : ''}${errorLine === i + 1 ? ' error' : ''}`}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="code-stack">
        <div className="code-layer" aria-hidden="true">
          <div ref={layerRef} className="code-layer-inner">
            <div className="code-line-hl" style={{ top: `calc(${current.line} * var(--code-lh))` }} />
            {errorLine ? <div className="code-line-error" style={{ top: `calc(${errorLine - 1} * var(--code-lh))` }} /> : null}
            {brackets.map((b, i) => (
              <div key={i} className="code-bracket-match" style={{ top: `calc(${b.line} * var(--code-lh))`, left: `calc(var(--code-pad-x) + ${b.column} * 1ch)` }} />
            ))}
            <pre className="code-pre">
              <HighlightedCode text={value} language={language} />
              {'\n'}
            </pre>
          </div>
        </div>
        <textarea
          ref={ref}
          className="code-input"
          value={value}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          wrap="off"
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onScroll={(e) => syncScroll(e.currentTarget)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={onBlur}
        />
      </div>
    </div>
  );
});
