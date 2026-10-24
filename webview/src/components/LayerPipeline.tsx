import { IconBolt, IconCloud, IconCog, IconDatabase, IconGlobe } from '../shared/icons';

/** The architecture layers a request passes through, as in the reference design. */
export function LayerPipeline() {
  return (
    <div className="flow-pipeline" aria-label="Architecture flow guide">
      <span className="pipe-step cat-frontend"><IconGlobe /> Frontend UI</span>
      <span className="pipe-arrow">→</span>
      <span className="pipe-step cat-api"><IconBolt /> API Route</span>
      <span className="pipe-arrow">→</span>
      <span className="pipe-step cat-backend"><IconCog /> Backend Logic</span>
      <span className="pipe-arrow">→</span>
      <span className="pipe-step cat-data"><IconDatabase /> Database &amp; Storage</span>
      <span className="pipe-step cat-external"><IconCloud /> External API</span>
    </div>
  );
}
