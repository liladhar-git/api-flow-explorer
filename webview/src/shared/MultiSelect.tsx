import { useEffect, useId, useRef, useState } from 'react';
import { IconChevronDown } from './icons';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  /** Values currently included (checked). */
  selected: string[];
  onChange(selected: string[]): void;
}

/** "All selected (12)" / "3 selected" / "None" dropdown with a checkbox per option. */
export function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const all = selected.length === options.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = all ? `All selected (${options.length})` : selected.length === 0 ? 'None selected' : `${selected.length} selected`;

  return (
    <div className="af-multi" ref={root}>
      <button type="button" className="af-multi-btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} aria-label={`${label}: ${summary}`} onClick={() => setOpen((o) => !o)}>
        <span>{summary}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div className="af-multi-pop" id={id} role="group" aria-label={label}>
          <div className="af-multi-actions">
            <button type="button" className="af-link" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
            <button type="button" className="af-link" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.map((o) => (
            <label key={o.value} className="af-check">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
