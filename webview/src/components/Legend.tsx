/** Node types, edge types and status styles, in three columns like the reference design. */
export function Legend() {
  const node = (cls: string, label: string) => (
    <li key={label}>
      <span className={`lg-swatch ${cls}`} />
      {label}
    </li>
  );
  const edge = (glyph: string, label: string) => (
    <li key={label}>
      <span className="lg-arrow" aria-hidden="true">{glyph}</span>
      {label}
    </li>
  );
  return (
    <section className="legend-grid" aria-label="Legend">
      <div>
        <h4>Node Types</h4>
        <ul className="lg-two">
          {node('sw-frontend', 'Frontend Component')}
          {node('sw-backend', 'Service')}
          {node('sw-api', 'API Endpoint')}
          {node('sw-data', 'Model')}
          {node('sw-backend', 'Controller')}
          {node('sw-external', 'External API')}
        </ul>
      </div>
      <div>
        <h4>Edge Types</h4>
        <ul className="lg-two">
          {edge('→', 'HTTP Request')}
          {edge('→', 'Reads / Writes')}
          {edge('→', 'Calls')}
          {edge('→', 'Imports')}
          {edge('→', 'Uses / Injects')}
          {edge('→', 'Renders')}
        </ul>
      </div>
      <div>
        <h4>Status</h4>
        <ul>
          <li><span className="lg-line solid" />Resolved</li>
          <li><span className="lg-line dashed" />Inferred</li>
          <li><span className="lg-line dotted" />Unresolved</li>
        </ul>
        <p className="hint">Dashed and dotted edges explain why they are not fully resolved when you select them.</p>
      </div>
    </section>
  );
}
