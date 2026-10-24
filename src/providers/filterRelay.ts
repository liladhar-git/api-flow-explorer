import { defaultFilterState, type FilterState } from '../types/filterState';

export type FilterOrigin = 'sidebar' | 'graph' | 'host';

/**
 * Single source of truth for the filters that both webviews show. Either side sends its change here; listeners (the host
 * wiring) forward it to the other side, never back to the one that sent it.
 */
export class FilterRelay {
  private state: FilterState = defaultFilterState();
  private readonly listeners = new Set<(f: FilterState, origin: FilterOrigin) => void>();

  get(): FilterState {
    return this.state;
  }

  update(next: FilterState, origin: FilterOrigin): void {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    for (const l of this.listeners) l(next, origin);
  }

  reset(origin: FilterOrigin = 'host'): void {
    this.update(defaultFilterState(), origin);
  }

  onChange(l: (f: FilterState, origin: FilterOrigin) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
