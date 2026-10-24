import { CATEGORY_NAME, KIND_NAME, methodOf } from '../state/display';
import type { TraceStep } from '../state/trace';
import { categoryOf } from '../types/view';

/** Ordered static call path. Each step opens the source line that creates the relationship. */
export function TraceList({ steps, horizontal, onOpenEvidence }: { steps: TraceStep[]; horizontal?: boolean; onOpenEvidence(edgeId: string): void }) {
  if (steps.length === 0) return <p className="hint">Select an endpoint or node to see the call path that starts there.</p>;
  return (
    <div className="trace">
      <p className="hint">Static call path derived from the source. It shows what can happen, not what was recorded at runtime.</p>
      <ol className={`trace-list${horizontal ? ' horizontal' : ''}`}>
        {steps.map((s) => {
          const toMethod = methodOf(s.to);
          return (
            <li key={s.edge.id} className={`trace-step res-${s.edge.resolution}`}>
              <span className="trace-index">{s.index}</span>
              <div className="trace-text">
                <div>
                  <b>{s.from.name}</b> <span className="trace-verb">{s.label}</span> {toMethod && <span className={`af-badge m-${toMethod}`}>{toMethod}</span>} <b>{s.to.name}</b>
                </div>
                <div className="trace-sub">
                  {CATEGORY_NAME[categoryOf(s.to)]} · {KIND_NAME[s.to.kind]} · {s.edge.confidence}
                  {s.edge.resolution === 'resolved' ? '' : ` ${s.edge.resolution}`}
                  {' · '}
                  <button className="af-link" onClick={() => onOpenEvidence(s.edge.id)} title={s.edge.evidence.explanation}>
                    {s.edge.evidence.path.split('/').pop()}:{s.edge.evidence.line}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
