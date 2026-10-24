import type { Confidence, Resolution } from '../types/graph';

export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function weakestConfidence(list: Iterable<Confidence>): Confidence {
  let w: Confidence = 'high';
  for (const c of list) if (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[w]) w = c;
  return w;
}

/**
 * Accumulates the evidence behind one relationship. It starts as `high`/`resolved` and only ever gets weaker; every
 * downgrade carries the reason that is later shown to the user, so a weak edge can always say why.
 */
export class Assessment {
  confidence: Confidence = 'high';
  resolution: Resolution = 'resolved';
  private readonly reasons: string[] = [];

  /** Cap confidence at `confidence`; `inferred` marks the relationship as derived rather than directly observed. */
  downgrade(confidence: Confidence, resolution: Exclude<Resolution, 'unresolved'>, reason: string): this {
    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[this.confidence]) this.confidence = confidence;
    if (resolution === 'inferred') this.resolution = 'inferred';
    this.reasons.push(reason);
    return this;
  }

  get reason(): string | undefined {
    return this.reasons.length ? this.reasons.join('; ') : undefined;
  }
}
