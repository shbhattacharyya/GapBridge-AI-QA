import { useState } from "react";

function Sidebar({ onLogout, currentTab, onTabChange, authUser }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [showAbout,   setShowAbout]   = useState(false);

  const displayName  = authUser?.name  || 'Guest';
  const displayEmail = authUser?.email || '';

  const tabs = [
    {
      key: 'jira-analysis',
      label: 'JIRA Analysis',
      icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>),
    },
    {
      key: 'test-case-module',
      label: 'Impacted Module Details',
      icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>),
    },
    {
      key: 'coverage-dashboard',
      label: 'XRAY Analysis',
      icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>),
    },
    {
      key: 'regression-suite',
      label: 'Regression Suite',
      icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>),
    },
    {
      key: 'history',
      label: 'Publish Report',
      icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>),
    },
  ];

  return (
    <>
    <div className="sidebar">
      <div className="logo">
        <div className="logo-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </div>
        <span className="logo-text">GapGuard QA</span>
      </div>

      <div className="user-info">
        <p className="welcome-label">WELCOME:</p>
        <p className="user-name">{displayName}</p>
        {displayEmail && <p className="user-email">{displayEmail}</p>}
      </div>

      <p className="section">ANALYSIS</p>

      {tabs.map(t => (
        <div
          key={t.key}
          className={`menu${currentTab === t.key ? ' active' : ''}`}
          onClick={() => onTabChange(t.key)}
        >
          <span className="menu-icon">{t.icon}</span>
          {t.label}
        </div>
      ))}

      <div className="footer">
        <div className="footer-item" onClick={() => setShowAbout(true)} style={{cursor:'pointer'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          About this tool
        </div>
        <div className="footer-item" onClick={() => setShowConfirm(true)} style={{cursor:'pointer'}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign Out
        </div>
      </div>
    </div>

    {showConfirm && (
      <div className="modal-overlay">
        <div className="modal-box">
          <h3 className="modal-title">Sign Out?</h3>
          <p className="modal-desc">Are you sure you want to sign out? All unsaved work will be lost.</p>
          <div className="modal-actions">
            <button className="modal-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
            <button className="modal-confirm" onClick={() => { setShowConfirm(false); onLogout(); }}>Sign Out</button>
          </div>
        </div>
      </div>
    )}

    {showAbout && (
      <div className="about-modal-overlay" onClick={() => setShowAbout(false)}>
        <div className="about-modal" onClick={e => e.stopPropagation()}>
          <div className="about-modal-header">
            <div className="about-modal-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span>GapGuard AI</span>
            </div>
            <p>
              GapGuard AI is an intelligent QA automation assistant that detects test coverage gaps, maps JIRA cards to XRAY test cases, and uses AI to generate missing tests — directly from your development workflow.
            </p>
          </div>
          <div className="about-modal-body">
            <p className="about-version">Version 1.0.0 · Hyland Internal · Hackathon 2026</p>
            <ul className="about-feat-list">
              <li><span className="about-feat-icon">🎫</span><div><strong>JIRA Integration</strong> — Fetches card details, description, TFS changeset links and test recommendations in one click.</div></li>
              <li><span className="about-feat-icon">📂</span><div><strong>TFS Code Analysis</strong> — Analyses the TFS changeset to identify impacted modules, changed files and code features.</div></li>
              <li><span className="about-feat-icon">🤖</span><div><strong>AI Test Generation</strong> — Uses Azure OpenAI + Copilot Studio to generate structured test cases mapped to impacted modules.</div></li>
              <li><span className="about-feat-icon">🔍</span><div><strong>XRAY Gap Analysis</strong> — Compares generated TCs against existing XRAY tests using semantic similarity to identify true gaps.</div></li>
              <li><span className="about-feat-icon">🚀</span><div><strong>One-Click Publish</strong> — Creates missing test cases directly in XRAY Cloud, assigns to the right folder, and links to the JIRA card.</div></li>
              <li><span className="about-feat-icon">📊</span><div><strong>Coverage Dashboard</strong> — Tracks test coverage history, gap trends and regression risk across all analysed cards.</div></li>
            </ul>
            <button className="about-modal-close" onClick={() => setShowAbout(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default Sidebar;