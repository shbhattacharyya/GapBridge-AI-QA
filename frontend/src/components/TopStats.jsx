function DonutChart({ percent }) {
  const radius = 28;
  const stroke = 5;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <svg width={radius * 2} height={radius * 2} style={{ transform: 'rotate(-90deg)' }}>
      <circle
        stroke="#e8eaf6"
        fill="transparent"
        strokeWidth={stroke}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
      <circle
        stroke="url(#donutGrad)"
        fill="transparent"
        strokeWidth={stroke}
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
      <defs>
        <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5b6cff" />
          <stop offset="100%" stopColor="#ff6eb4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function TopStats() {
  return (
    <>
      {/* Header */}
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{marginRight:'8px',verticalAlign:'middle'}}>
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            AI Test Coverage Analysis
          </h2>
          <p>Intelligent test case generation + XRAY repository mapping</p>
        </div>
        <div className="analysis-badges">
          <span className="badge-jira">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:'4px'}}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            JIRA: SBPWC-10999
          </span>
          <span className="badge-complete">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:'4px'}}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Analysis Complete
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="stats">
        <div className="stat-card green">
          <div className="stat-icon green-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p>Total Test Cases</p>
          <h2>10</h2>
        </div>

        <div className="stat-card red">
          <div className="stat-icon red-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p>Missing Cases</p>
          <h2>4</h2>
        </div>

        <div className="stat-card blue">
          <div className="stat-icon blue-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
          </div>
          <p>Existing Matches</p>
          <h2>6</h2>
        </div>

        <div className="stat-card coverage-card">
          <div className="coverage-donut">
            <DonutChart percent={60} />
            <span className="coverage-label">60%</span>
          </div>
          <p>Coverage</p>
          <h2 className="hidden-num">60%</h2>
        </div>

        <div className="stat-card orange">
          <div className="stat-icon orange-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <p>Risk Level</p>
          <span className="risk-badge high">High</span>
        </div>
      </div>
    </>
  );
}

export default TopStats;