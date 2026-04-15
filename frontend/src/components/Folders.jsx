function Folders() {
  return (
    <div className="card">
      <div className="folders-header">
        <span className="folders-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </span>
        <h4>Detected XRAY Folders</h4>
      </div>

      <div className="folder-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{marginRight:'8px',flexShrink:0}}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span>Accessibility &gt; WorkView Designer</span>
        <span className="folder-count">4</span>
      </div>

      <div className="folder-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{marginRight:'8px',flexShrink:0}}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span>Accessibility &gt; Screen Reader</span>
        <span className="folder-count">2</span>
      </div>

      <div className="folder-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{marginRight:'8px',flexShrink:0}}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
        <span>Attributes &gt; Attribute Validation</span>
        <span className="folder-count">1</span>
      </div>

      <p className="note">AI mapped based on UI display &amp; revision logic changes</p>
    </div>
  );
}

export default Folders;