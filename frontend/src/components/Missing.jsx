function Missing() {
  return (
    <div className="card missing-section">
      <div className="missing-header">
        <div className="missing-title-group">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2.5" style={{flexShrink:0}}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h4 className="missing-title-text">Missing Test Cases (4)</h4>
        </div>
        <span className="view-all-link">View All →</span>
      </div>

      <div className="missing-item-new">
        <div className="missing-item-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2.5" style={{flexShrink:0}}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="missing-item-title">Verify no prefix for Rendition-only document type</p>
            <p className="missing-item-sub">Primary bug scenario not covered in repository</p>
          </div>
        </div>
        <div className="missing-item-right">
          <span className="tag high">High</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>

      <div className="missing-item-new">
        <div className="missing-item-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2.5" style={{flexShrink:0}}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="missing-item-title">Cross-platform validation (Web Client)</p>
            <p className="missing-item-sub">Web display behavior not found in existing tests</p>
          </div>
        </div>
        <div className="missing-item-right">
          <span className="tag medium">Medium</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>

      <div className="missing-item-new">
        <div className="missing-item-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2.5" style={{flexShrink:0}}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="missing-item-title">Unity Client dynamic folder display</p>
            <p className="missing-item-sub">Client-specific UI rendering test missing</p>
          </div>
        </div>
        <div className="missing-item-right">
          <span className="tag medium">Medium</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>

      <div className="missing-item-new">
        <div className="missing-item-left">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" strokeWidth="2.5" style={{flexShrink:0}}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <p className="missing-item-title">No revision flags scenario</p>
            <p className="missing-item-sub">Edge case with no flags not validated</p>
          </div>
        </div>
        <div className="missing-item-right">
          <span className="tag low">Low</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        </div>
      </div>
    </div>
  );
}

export default Missing;