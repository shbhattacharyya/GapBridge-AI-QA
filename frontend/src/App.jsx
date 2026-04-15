import { useState, Fragment, useEffect } from "react";
import Login from "./components/Login";
import Sidebar from "./components/Sidebar";
import LeftPanel from "./components/LeftPanel";
import TopStats from "./components/TopStats";
import Folders from "./components/Folders";
import Missing from "./components/Missing";
import Existing from "./components/Existing";
import "./App.css";

/* ── Description / Test-Rec structured parsers ──────────────────────────── */

// Icons for known section labels
const _SECTION_ICONS = {
  'summary': '📋', 'description': '📋', 'overview': '📋',
  'business impact': '💼', 'impact': '💼', 'impacts to other': '💼',
  'actual behavior': '🔴', 'desired behavior': '✅', 'actual behavior vs': '⚖️',
  'customer pain': '⚠️', 'defect': '🐛',
  'reported version': '🏷️', 'latest version': '🏷️', 'version': '🏷️',
  'backport': '🔁',
  'setup notes': '⚙️', 'setup': '⚙️',
  'detailed description': '📝',
  'unaffected': '✔️', 'unaffected areas': '✔️',
  'architectural': '🏗️', 'other affected': '🏗️',
};

function _sectionIcon(label) {
  const low = label.toLowerCase();
  return Object.entries(_SECTION_ICONS).find(([k]) => low.includes(k))?.[1] || '▸';
}

// Parse text that uses [ Section Name ] markers (JIRA Description format)
function parseJiraDescription(text) {
  if (!text) return null;
  const parts = text.split(/\[\s*([^\]]{3,60}?)\s*\]/);
  if (parts.length < 3) return null; // no markers — plain text
  const sections = [];
  // parts: [before, label, content, label, content, ...]
  for (let i = 1; i < parts.length - 1; i += 2) {
    const label   = parts[i].trim();
    const content = (parts[i + 1] || '').trim();
    if (content) sections.push({ label, content });
  }
  return sections.length >= 2 ? sections : null;
}

// Parse text that uses [Section]: markers (Test Recommendation format)
function parseTestRecommendation(text) {
  if (!text) return null;
  // Split on [Label]: or [Label] at start of a segment
  const parts = text.split(/\[([^\]]{3,60}?)\]\s*:?\s*/);
  if (parts.length < 3) return null;
  const sections = [];
  for (let i = 1; i < parts.length - 1; i += 2) {
    const label   = parts[i].trim();
    const content = (parts[i + 1] || '').trim();
    if (content) sections.push({ label, content });
  }
  return sections.length >= 2 ? sections : null;
}

// Render a parsed section list nicely
function StructuredText({ sections, accentColor = '#5b6cff' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {sections.map((sec, i) => (
        <div key={i} style={{
          background: i === 0 ? '#f8f9ff' : '#fff',
          border: '1px solid #eaecf5',
          borderRadius: '7px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '5px 10px',
            background: `${accentColor}12`,
            borderBottom: '1px solid #eaecf5',
            fontSize: '11px',
            fontWeight: 700,
            color: accentColor,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
          }}>
            <span style={{ fontSize: '13px' }}>{_sectionIcon(sec.label)}</span>
            {sec.label}
          </div>
          <div style={{ padding: '8px 10px', fontSize: '13px', color: '#2d3748', lineHeight: 1.6 }}>
            {_renderSectionContent(sec.content)}
          </div>
        </div>
      ))}
    </div>
  );
}

// Within a section, split sentences/steps into bullet points for readability
function _renderSectionContent(text) {
  // Split on sentence boundaries or explicit step patterns
  const lines = text
    .split(/(?<=[.?!])\s+(?=[A-Z])|(?:\r?\n)+/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return <span>{text}</span>;
  }
  return (
    <ul style={{ margin: 0, paddingLeft: '16px', listStyleType: 'disc' }}>
      {lines.map((line, i) => (
        <li key={i} style={{ marginBottom: '3px' }}>{line}</li>
      ))}
    </ul>
  );
}

// Top-level component: tries structured render, falls back to plain text
function SmartText({ text, accentColor }) {
  const sections = parseJiraDescription(text) || parseTestRecommendation(text);
  if (sections) return <StructuredText sections={sections} accentColor={accentColor} />;
  // Plain text — just wrap nicely with line breaks
  return (
    <p style={{ margin: 0, fontSize: '13px', color: '#2d3748', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
      {text}
    </p>
  );
}

/* â”€â”€ Donut chart helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function DonutRing({ percent }) {
  const r = 23, sw = 5, nr = r - sw;
  const circ = nr * 2 * Math.PI;
  const offset = circ - (percent / 100) * circ;
  return (
    <svg width={r * 2} height={r * 2} style={{ transform: 'rotate(-90deg)' }}>
      <circle stroke="#e8eaf6" fill="transparent" strokeWidth={sw} r={nr} cx={r} cy={r} />
      <circle stroke="url(#dg3)" fill="transparent" strokeWidth={sw}
        strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset}
        strokeLinecap="round" r={nr} cx={r} cy={r} />
      <defs>
        <linearGradient id="dg3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5b6cff" />
          <stop offset="100%" stopColor="#ff6eb4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* â”€â”€ Regression meta: compute automation feasibility for a TC â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function _computeRegressionMeta(tc) {
  if (tc.automation_score !== undefined) return tc; // already enriched by backend
  const title = (tc.title || '').toLowerCase();
  let cat = 'OTHER';
  for (const c of ['REGRESSION', 'PERSISTENCE', 'BOUNDARY', 'EDGE CASE', 'NEGATIVE']) {
    if (title.includes(`[${c.toLowerCase()}]`)) { cat = c; break; }
  }
  const base  = { REGRESSION: 95, PERSISTENCE: 90, BOUNDARY: 85, 'EDGE CASE': 75, NEGATIVE: 70, OTHER: 65 };
  const bonus = tc.priority === 'High' ? 5 : tc.priority === 'Low' ? -10 : 0;
  const score = Math.min(100, Math.max(0, (base[cat] || 65) + bonus));
  const feasible = score >= 70;
  const deepMeta = {
    REGRESSION: {
      reasons: ['Deterministic logic', 'Frequent issue area'],
      approach: 'Selenium WebDriver / Playwright — scripted happy-path regression run, assert final UI state and persisted data.',
      blockers: [],
      not_feasible_reason: null,
      not_feasible_example: null,
    },
    PERSISTENCE: {
      reasons: ['Deterministic logic', 'High impact module'],
      approach: 'API-level integration test (pytest + requests) — create → save → reload → assert data persists across sessions.',
      blockers: [],
      not_feasible_reason: null,
      not_feasible_example: null,
    },
    BOUNDARY: {
      reasons: ['Deterministic logic', 'High impact module', 'Stable API/UI flow'],
      approach: 'Parameterized data-driven test — boundary values injected via CSV/Excel, assertions on validation messages and field limits.',
      blockers: [],
      not_feasible_reason: null,
      not_feasible_example: null,
    },
    'EDGE CASE': {
      reasons: feasible ? ['Edge case coverage', 'High impact module'] : ['Complex state simulation', 'Non-deterministic behaviour'],
      approach: feasible ? 'Playwright test with controlled state setup — navigate to edge condition, assert DOM attributes and error state.' : null,
      blockers: feasible ? [] : ['Requires complex concurrent-state simulation', 'DOM attributes do not reflect edge-condition visually'],
      not_feasible_reason: feasible ? null : 'Edge case involves visual rendering triggered by concurrent user actions that cannot be reliably reproduced headlessly.',
      not_feasible_example: feasible ? null : 'e.g. Verifying WorkView filter column reflow after two users simultaneously edit the same filter layout — requires real-time multi-session simulation; Selenium/Playwright cannot assert pixel-level column reorder animations.',
    },
    NEGATIVE: {
      reasons: ['Frequent issue area', 'Edge case coverage'],
      approach: 'Negative-path test — inject invalid inputs programmatically, assert validation error text and no-save behaviour via DOM assertions.',
      blockers: [],
      not_feasible_reason: null,
      not_feasible_example: null,
    },
    OTHER: {
      reasons: feasible ? ['Standard coverage', 'Stable UI flow'] : ['Manual judgement required', 'Non-deterministic output'],
      approach: feasible ? 'Standard Playwright UI flow test — click through workflow, assert expected outcome in DOM.' : null,
      blockers: feasible ? [] : ['Test outcome requires human visual or contextual judgement', 'No assertable DOM target for pass/fail'],
      not_feasible_reason: feasible ? null : 'Test outcome depends on subjective user experience or visual layout that cannot be expressed as a DOM assertion.',
      not_feasible_example: feasible ? null : 'e.g. Confirming the "feel" of drag-and-drop column reordering in a WorkView filter grid — requires human confirmation that the reordered state looks correct; Selenium can trigger the drag event but cannot verify the visual result without pixel-comparison tools.',
    },
  };
  const meta = deepMeta[cat] || deepMeta['OTHER'];
  return {
    ...tc,
    automation_score: score,
    automation_feasible: feasible,
    automation_reasons: meta.reasons,
    automation_approach: meta.approach,
    automation_blockers: meta.blockers,
    not_feasible_reason: meta.not_feasible_reason,
    not_feasible_example: meta.not_feasible_example,
    regression_candidate: score >= 70,
    _tc_category: cat,
  };
}

/* â”€â”€ JIRA Details panel (right pane after fetch) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function JiraDetails({ onAnalyze, onViewAnalysis, data, analyzing, analyzeError, analyzeData }) {
  const priorityClass = (data?.priority || '').toLowerCase().includes('high') ? 'high'
    : (data?.priority || '').toLowerCase().includes('low') ? 'low'
    : 'medium';

  const recommendations = analyzeData?.mrg?.test_cases || [];
  const features        = analyzeData?.tfs?.impacted_features || [];
  const modules         = analyzeData?.tfs?.impacted_modules  || [];
  const hasResults      = !!analyzeData;

  return (
    <div className="jira-details-panel">
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            JIRA Card Details
          </h2>
          <p>Fetched successfully — review and proceed to AI analysis</p>
        </div>
        <div className="analysis-badges">
          <span className="badge-jira">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            JIRA: {data?.id}
          </span>
          <span className="badge-complete">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '4px' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Fetched
          </span>
        </div>
      </div>

      <div className="jira-fields-grid">
        <div className="jira-field-block">
          <span className="jira-field-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '5px' }}>
              <line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" />
            </svg>
            Title
          </span>
          <p className="jira-field-value title-val">{data?.title || '—'}</p>
        </div>

        <div className="jira-field-block">
          <span className="jira-field-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '5px' }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Description
          </span>
          <SmartText text={data?.description || '—'} />
        </div>

        {data?.test_recommendation && (
          <div className="jira-field-block">
            <span className="jira-field-label" style={{ color: '#5b6cff' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '5px' }}>
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
              Test Recommendation (from JIRA)
            </span>
            <SmartText text={data.test_recommendation} accentColor="#5b6cff" />
          </div>
        )}

        <div className="jira-meta-row">
          <div className="jira-meta-block">
            <span className="jira-field-label">TFS ID</span>
            <span className="jira-tfs-badge"># {data?.tfs_id || 'N/A'}</span>
          </div>
          <div className="jira-meta-block">
            <span className="jira-field-label">Priority</span>
            <span className={`tag ${priorityClass}`}>{data?.priority || 'Medium'}</span>
          </div>
          <div className="jira-meta-block">
            <span className="jira-field-label">Status</span>
            <span className="jira-status-badge">{data?.status || '—'}</span>
          </div>
          <div className="jira-meta-block">
            <span className="jira-field-label">Component</span>
            <span className="jira-component-badge">{data?.component || 'N/A'}</span>
          </div>
        </div>

        <div className="jira-field-block">
          <span className="jira-field-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '5px' }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            AI Test Recommendations
          </span>
          {hasResults && recommendations.length > 0 ? (
            <ol className="ai-tc-list" style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
              {recommendations.map((tc, i) => (
                <li key={i} className="ai-tc-item">{tc}</li>
              ))}
            </ol>
          ) : hasResults && recommendations.length === 0 ? (
            <p className="jira-field-value desc-val" style={{ color: '#a0a3b1', fontStyle: 'italic' }}>
              No structured test cases in MRG response — see full analysis for details.
            </p>
          ) : (
            <p className="jira-field-value desc-val" style={{ color: '#a0a3b1', fontStyle: 'italic' }}>
              Click <strong style={{ fontStyle: 'normal', color: '#5b6cff' }}>Analyze the Impact Areas</strong> below to derive modules, TFS change logs and MRG documentation.
            </p>
          )}
        </div>

        {hasResults && (features.length > 0 || modules.length > 0) && (
          <div className="jira-field-block">
            <span className="jira-field-label">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '5px' }}>
                <rect x="2" y="3" width="6" height="4" rx="1" /><rect x="10" y="4" width="12" height="2" rx="1" />
                <rect x="2" y="10" width="6" height="4" rx="1" /><rect x="10" y="11" width="12" height="2" rx="1" />
                <rect x="2" y="17" width="6" height="4" rx="1" /><rect x="10" y="18" width="12" height="2" rx="1" />
              </svg>
              Impacted Areas (from TFS Changeset)
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
              {modules.map((m, i) => (
                <span key={`mod-${i}`} className="jira-component-badge" style={{ fontSize: '11px' }}>{m}</span>
              ))}
              {features.map((f, i) => (
                <span key={`feat-${i}`} className="jira-tfs-badge" style={{ fontSize: '11px', background: '#f0f1ff', color: '#5b6cff', border: '1px solid #d0d4ff' }}>{f}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {analyzeError && (
        <div className="fetch-error-banner" style={{ marginTop: '8px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:'7px',flexShrink:0}}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {analyzeError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
        <button className="btn" onClick={onAnalyze} disabled={analyzing}
          style={{ background: analyzing ? undefined : 'linear-gradient(135deg,#4a5bef 0%,#6c7fff 100%)' }}>
          {analyzing ? (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{animation:'spin 1s linear infinite'}}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              Analyzing impact areas…
            </>
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">               
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              Analyze the Impact Areas
            </>
          )}
        </button>

        {hasResults && (
          <button className="btn" onClick={onViewAnalysis}
            style={{ background: 'linear-gradient(135deg,#1e8f4e 0%,#34c471 100%)', boxShadow: '0 2px 8px rgba(30,143,78,0.30), inset 0 1px 0 rgba(255,255,255,0.12)', letterSpacing: '0.3px' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
            </svg>
            View Full Analysis
          </button>
        )}
      </div>
    </div>
  );
}

/* â”€â”€ Impacted modules data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const MODULES = [
  { name: 'WorkView Designer',     path: 'Accessibility > WorkView Designer',      tests: 4, status: 'impacted' },
  { name: 'Screen Reader Support', path: 'Accessibility > Screen Reader',           tests: 2, status: 'impacted' },
  { name: 'Attribute Validation',  path: 'Attributes > Attribute Validation',       tests: 1, status: 'impacted' },
  { name: 'Revision Control',      path: 'Document Management > Revision Control',  tests: 3, status: 'impacted' },
  { name: 'Document Title Bar',    path: 'Unity Client > Title Bar Rendering',      tests: 2, status: 'review'   },
  { name: 'Client Sync Layer',     path: 'Unity Client > Sync',                     tests: 1, status: 'review'   },
];

/* â”€â”€ Test Case & Module Details page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function TestCaseModuleDetails({ onProceedToXray, analyzeData }) {
  const jira   = analyzeData?.jira;
  const tfs    = analyzeData?.tfs;
  const mrg    = analyzeData?.mrg;
  const cardId = jira?.id || 'SBPWC-10999';
  const displayModules = (() => {
    const mods    = tfs?.impacted_modules  || [];
    const feats   = tfs?.impacted_features || [];
    if (mods.length === 0 && feats.length === 0) return MODULES;
    // Merge: modules from path analysis + features from code analysis
    const modItems   = mods.map(m  => ({ name: m, path: 'Assembly / Namespace', tests: 1, status: 'impacted', kind: 'module' }));
    const featItems  = feats.map(f => ({ name: f, path: 'Code Feature (TFS Snippet)', tests: 1, status: 'review',   kind: 'feature' }));
    return [...modItems, ...featItems];
  })();
  const aiTestCases = mrg?.test_cases || [];
  const mrgContent  = mrg?.mrg_content || null;
  return (
    <div className="tcmd-page">
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Impacted Module Details
          </h2>
          <p>AI-generated test cases + impacted module mapping for {cardId}</p>
        </div>
        <div className="analysis-badges">
          <span className="badge-jira">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
            </svg>
            JIRA: {cardId}
          </span>
        </div>
      </div>

      {aiTestCases.length > 0 && (
        <div className="card ai-testcases-card">
          <div className="ai-tc-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <h4>AI Generated Test Cases ({aiTestCases.length})</h4>
            <span className="ai-tc-source-badge">via Copilot Studio</span>
          </div>
          <ol className="ai-tc-list">
            {aiTestCases.map((tc, i) => (
              <li key={i} className="ai-tc-item">{tc}</li>
            ))}
          </ol>
        </div>
      )}

      {tfs?.changed_files?.length > 0 && (
        <div className="card tfs-log-card">
          <div className="tfs-log-card-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e05a1b" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V9l-6-6z" />
              <polyline points="9 3 9 9 15 9" />
            </svg>
            <h4>TFS Change Log — Changeset #{tfs?.changeset_id}</h4>
            <span className="tfs-log-meta">{tfs?.changed_files.length} file{tfs.changed_files.length !== 1 ? 's' : ''} changed &bull; {tfs?.author} &bull; {tfs?.date}</span>
          </div>
          <div className="tfs-log-table-wrap">
            <table className="tfs-log-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Change</th>
                  <th>Server Path</th>
                  <th>Local</th>
                </tr>
              </thead>
              <tbody>
                {tfs.changed_files.map((f, i) => {
                  const filename = f.server_path.split('/').pop() || f.server_path.split('\\').pop();
                  const ct = (f.change_type || 'edit').toLowerCase();
                  return (
                    <tr key={i}>
                      <td className="tfs-filename">{filename}</td>
                      <td><span className={`ct-badge ct-${ct}`}>{ct.charAt(0).toUpperCase() + ct.slice(1)}</span></td>
                      <td className="tfs-path" title={f.server_path}>{f.server_path}</td>
                      <td className="tfs-local">{f.exists_locally ? <span className="tfs-local-yes">✔</span> : <span className="tfs-local-no">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card impacted-modules-card">
        <div className="impacted-modules-header">
          <div className="impacted-title-group">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
              <rect x="2" y="3" width="6" height="4" rx="1" /><rect x="10" y="4" width="12" height="2" rx="1" />
              <rect x="2" y="10" width="6" height="4" rx="1" /><rect x="10" y="11" width="12" height="2" rx="1" />
              <rect x="2" y="17" width="6" height="4" rx="1" /><rect x="10" y="18" width="12" height="2" rx="1" />
            </svg>
            <h4>Impacted Modules ({displayModules.length})</h4>
          </div>
          <span className="modules-sub-label">Modules requiring test case additions or review</span>
        </div>
        <div className="modules-list">
          {displayModules.map((m, i) => (
            <div key={i} className="module-item">
              <div className="module-item-left">
                <div className={`module-dot ${m.status}`} />
                <div>
                  <p className="module-name">{m.name}</p>
                  <span className="module-path-text">{m.path}</span>
                </div>
              </div>
              <div className="module-item-right">
                {m.kind === 'feature' && (
                  <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '10px', background: '#f0f1ff', color: '#5b6cff', border: '1px solid #d0d4ff', marginRight: '6px' }}>
                    Code Feature
                  </span>
                )}
                {m.kind === 'module' && (
                  <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '10px', background: '#e8f9ee', color: '#2e7d32', border: '1px solid #c3e6cb', marginRight: '6px' }}>
                    Assembly
                  </span>
                )}
                <span className={`module-badge ${m.status}`}>{m.status === 'impacted' ? 'Impacted' : 'Review'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {mrgContent && (
        <div className="card mrg-card">
          <div className="mrg-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <h4>MRG — Product Feature Documentation</h4>
            <span className="mrg-source-badge">via Copilot Studio</span>
          </div>
          <div className="mrg-content">{mrgContent}</div>
        </div>
      )}

      <div className="tcmd-actions">
        <button className="tcmd-btn tcmd-btn-primary" onClick={onProceedToXray} style={{ minWidth: '240px' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '8px' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          Proceed with XRAY Analysis
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Publish Review page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function PublishReview({ tcsToPush, analyzeData, onBack, onPublished }) {
  const jiraId          = analyzeData?.jira?.id || '';
  const jiraTitle       = analyzeData?.jira?.title || '';
  const jiraBaseUrl     = analyzeData?.jira_base_url || 'https://hyland.atlassian.net';
  const project         = jiraId.split('-')[0] || 'SBPWC';
  const rawSuggested    = analyzeData?.xray?.folders || [];
  const suggestedFolders= rawSuggested.length > 0 ? rawSuggested : ['/Miscellaneous'];
  const modules         = [...new Set(tcsToPush.map(t => t.module).filter(Boolean))];

  const [folderMode,      setFolderMode]      = useState('suggested');
  const [selectedSugg,    setSelectedSugg]    = useState(suggestedFolders[0]);
  const [otherFolder,     setOtherFolder]     = useState('');
  const [folderSearch,    setFolderSearch]    = useState('');
  const [allFolders,      setAllFolders]      = useState([]);
  const [foldersLoading,  setFoldersLoading]  = useState(false);
  const [newFolderName,   setNewFolderName]   = useState('');
  const [newFolderParent, setNewFolderParent] = useState(suggestedFolders[0]);
  const [publishing,      setPublishing]      = useState(false);
  const [publishError,    setPublishError]    = useState(null);
  const [folderError,     setFolderError]     = useState(null);

  const fetchFolders = (force = false) => {
    if ((allFolders.length > 0 || foldersLoading) && !force) return;
    setFoldersLoading(true);
    setFolderError(null);
    fetch(`/api/xray/folders/${project}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        const list = d.folders || [];
        setAllFolders(list);
        if (list.length === 0) setFolderError(`No folders found in XRAY project ${project}`);
        setFoldersLoading(false);
      })
      .catch(e => {
        setFolderError(`Could not load XRAY folders: ${e.message}`);
        setFoldersLoading(false);
      });
  };

  const handleModeChange = (mode) => {
    setFolderMode(mode);
    if (mode === 'other' || mode === 'new') fetchFolders();
  };

  // Build module → XRAY folder mapping from TC nearest_folder data
  const moduleFolderMap = {};
  tcsToPush.forEach(tc => {
    const mod = tc.module;
    if (mod && !moduleFolderMap[mod]) {
      moduleFolderMap[mod] = tc.nearest_folder || null;
    }
  });

  // Impact analysis (client-side)
  const highCount  = tcsToPush.filter(t => t.priority === 'High').length;
  const medCount   = tcsToPush.filter(t => t.priority === 'Medium').length;
  const lowCount   = tcsToPush.filter(t => t.priority === 'Low').length;
  const total      = tcsToPush.length;
  const regrScore  = (highCount * 3 + medCount) / Math.max(total, 1);
  const addToRegr  = regrScore >= 1.5 || highCount >= 1;
  const maxPri     = Math.max(highCount, medCount, lowCount, 1);

  const getTargetFolder = () => {
    if (folderMode === 'suggested') return selectedSugg;
    if (folderMode === 'other')     return otherFolder;
    const parent = (newFolderParent || '/').replace(/\/$/, '');
    return newFolderName.trim() ? `${parent}/${newFolderName.trim()}` : '';
  };

  const canPublish = folderMode === 'suggested' ? !!selectedSugg
    : folderMode === 'other' ? !!otherFolder
    : !!newFolderName.trim();

  const handlePublish = async () => {
    setPublishing(true); setPublishError(null);
    try {
      const res = await fetch('/api/xray/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira_id:           jiraId,
          jira_title:        jiraTitle,
          test_cases:        tcsToPush,
          folder_path:       folderMode !== 'new' ? getTargetFolder() : '',
          create_folder:     folderMode === 'new',
          new_folder_name:   folderMode === 'new' ? newFolderName.trim() : '',
          new_folder_parent: folderMode === 'new' ? (newFolderParent || '/') : '',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || 'Publish failed');
      }
      onPublished(await res.json());
    } catch (e) { setPublishError(e.message); }
    finally { setPublishing(false); }
  };

  const filteredOther = folderSearch
    ? allFolders.filter(f => f.toLowerCase().includes(folderSearch.toLowerCase()))
    : allFolders;

  const regrColor  = addToRegr ? '#e53935' : '#10b870';
  const regrLabel  = addToRegr ? 'ADD TO REGRESSION' : 'SMOKE ONLY';

  return (
    <div className="pub-page">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
            </svg>
            Publish to XRAY — Review
          </h2>
          <p>Review test cases and select a destination folder, then confirm to create in XRAY Cloud</p>
        </div>
        <div className="analysis-badges">
          <span className="badge-jira">{jiraId}</span>
          <span className="badge-complete">{total} TC{total !== 1 ? 's' : ''} to publish</span>
          <span className="badge-complete" style={{ background: addToRegr ? '#fff0f0' : '#e8f9ee', color: regrColor, borderColor: addToRegr ? '#ffcdd2' : '#b2eac7' }}>{regrLabel}</span>
        </div>
      </div>

      {/* â”€â”€ Stats row â”€â”€ */}
      <div className="pub-stats-row">
        {[
          { val: total,          label: 'Test Cases',    color: '#5b6cff' },
          { val: modules.length, label: 'Modules',       color: '#5b6cff' },
          { val: highCount,      label: 'High Priority', color: '#e53935' },
          { val: medCount,       label: 'Medium',        color: '#f59e0b' },
          { val: lowCount,       label: 'Low',           color: '#3b82f6' },
        ].map((s, i) => (
          <div key={i} className="pub-stat-card">
            <span className="pub-stat-val" style={{ color: s.color }}>{s.val}</span>
            <span className="pub-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* â”€â”€ FOLDER SELECTOR â”€â”€ */}
      <div className="card pub-folder-card">
        <div className="pub-section-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
          </svg>
          <h4>Target XRAY Folder</h4>
          <span className="pub-section-sub">Where should these test cases be created in XRAY?</span>
        </div>

        {/* Option 1 – Suggested */}
        <div className={`pub-folder-option${folderMode === 'suggested' ? ' active' : ''}`} onClick={() => handleModeChange('suggested')}>
          <div className="pub-folder-option-radio">
            <div className={`pub-radio-dot${folderMode === 'suggested' ? ' selected' : ''}`}/>
          </div>
          <div className="pub-folder-option-body">
            <span className="pub-folder-option-title">Suggested — folders from gap analysis</span>
            <span className="pub-folder-option-sub">
              {rawSuggested.length > 0
                ? `${rawSuggested.length} folder${rawSuggested.length !== 1 ? 's' : ''} detected during XRAY scan`
                : 'No module detected — defaulting to /Miscellaneous'}
            </span>
            {folderMode === 'suggested' && (
              <select className="pub-folder-select" value={selectedSugg} onChange={e => setSelectedSugg(e.target.value)}
                onClick={e => e.stopPropagation()}>
                {suggestedFolders.map((f, i) => (
                  <option key={i} value={f}>
                    {f}{rawSuggested.length === 0 && f === '/Miscellaneous' ? '  (default — no module detected)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Option 2 – Other */}
        <div className={`pub-folder-option${folderMode === 'other' ? ' active' : ''}`} onClick={() => handleModeChange('other')}>
          <div className="pub-folder-option-radio">
            <div className={`pub-radio-dot${folderMode === 'other' ? ' selected' : ''}`}/>
          </div>
          <div className="pub-folder-option-body">
            <span className="pub-folder-option-title">Other — browse XRAY repository</span>
            <span className="pub-folder-option-sub">Choose any existing folder in project {project}</span>
            {folderMode === 'other' && (
              <div onClick={e => e.stopPropagation()}>
                <input type="text" className="pub-folder-search" placeholder="🔍 Search folders..."
                  value={folderSearch} onChange={e => setFolderSearch(e.target.value)} />
                {foldersLoading
                  ? <p className="pub-loading">Loading folders from XRAY…</p>
                  : folderError
                  ? <div className="pub-folder-fetch-error">
                      <span>{folderError}</span>
                      <button className="pub-folder-retry-btn" onClick={() => fetchFolders(true)}>Retry</button>
                    </div>
                  : <div className="pub-folder-listbox-custom">
                      {filteredOther.length === 0
                        ? <div className="pub-folder-listbox-empty">No folders match "{folderSearch}"</div>
                        : filteredOther.map((f, i) => (
                            <div key={i}
                              className={`pub-folder-listbox-item${otherFolder === f ? ' selected' : ''}`}
                              onClick={() => setOtherFolder(f)}>
                              {f}
                            </div>
                          ))
                      }
                    </div>
                }
                {otherFolder && <div className="pub-selected-path">📂 Selected: <code>{otherFolder}</code></div>}
              </div>
            )}
          </div>
        </div>

        {/* Option 3 – Create new */}
        <div className={`pub-folder-option${folderMode === 'new' ? ' active' : ''}`} onClick={() => handleModeChange('new')}>
          <div className="pub-folder-option-radio">
            <div className={`pub-radio-dot${folderMode === 'new' ? ' selected' : ''}`}/>
          </div>
          <div className="pub-folder-option-body">
            <span className="pub-folder-option-title">Create new folder</span>
            <span className="pub-folder-option-sub">Create a new subfolder under any existing parent</span>
            {folderMode === 'new' && (
              <div className="pub-new-folder-wrap" onClick={e => e.stopPropagation()}>
                <div className="pub-new-folder-row">
                  <label className="pub-new-folder-label">Parent folder</label>
                  {foldersLoading
                    ? <p className="pub-loading">Loading…</p>
                    : folderError
                    ? <div className="pub-folder-fetch-error">
                        <span>{folderError}</span>
                        <button className="pub-folder-retry-btn" onClick={() => fetchFolders(true)}>Retry</button>
                      </div>
                    : <div className="pub-folder-listbox-custom" style={{ maxHeight: 160 }}>
                        <div
                          className={`pub-folder-listbox-item${newFolderParent === '/' ? ' selected' : ''}`}
                          onClick={() => setNewFolderParent('/')}>
                          /  (root)
                        </div>
                        {allFolders.map((f, i) => (
                          <div key={i}
                            className={`pub-folder-listbox-item${newFolderParent === f ? ' selected' : ''}`}
                            onClick={() => setNewFolderParent(f)}>
                            {f}
                          </div>
                        ))}
                      </div>
                  }
                </div>
                <div className="pub-new-folder-row">
                  <label className="pub-new-folder-label">New folder name</label>
                  <input type="text" className="pub-new-folder-input"
                    placeholder={`e.g. ${jiraId} - ${jiraTitle.split(' ').slice(0, 4).join(' ')}`}
                    value={newFolderName} onChange={e => setNewFolderName(e.target.value)} />
                </div>
                {newFolderName.trim() && (
                  <div className="pub-selected-path">
                    📂 Will create: <code>{(newFolderParent || '/').replace(/\/$/, '')}/{newFolderName.trim()}</code>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* â”€â”€ TC TABLE â”€â”€ */}
      <div className="card pub-tc-card">
        <div className="pub-section-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/>
          </svg>
          <h4>Test Cases to be Created ({total})</h4>
        </div>
        <div className="xray-gap-table-wrap">
          <table className="xray-gap-table pub-tc-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ width: 72 }}>TC ID</th>
                <th>Title</th>
                <th style={{ width: 160 }}>Module</th>
                <th style={{ width: 88 }}>Priority</th>
              </tr>
            </thead>
            <tbody>
              {tcsToPush.map((tc, i) => (
                <tr key={i} className="xray-gap-row xray-row-new">
                  <td className="xray-gt-num">{i + 1}</td>
                  <td><span className="xray-tc-id">{tc.id}</span></td>
                  <td className="xray-gt-title">{tc.title}</td>
                  <td><span className="xray-tc-module-chip">{tc.module || '—'}</span></td>
                  <td><span className={`xray-priority-chip ${(tc.priority || 'Medium').toLowerCase()}`}>{tc.priority}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* â”€â”€ Modules affected â”€â”€ */}
      {modules.length > 0 && (
        <div className="card pub-modules-card">
          <div className="pub-section-hdr">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
            </svg>
            <h4>Modules Affected &amp; XRAY Folder Mapping</h4>
          </div>
          <div className="pub-modules-list">
            {modules.map((m, i) => (
              <div key={i} className="pub-module-row">
                <span className="pub-module-chip">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                  </svg>
                  {m}
                </span>
                {moduleFolderMap[m] && (
                  <span className="pub-module-folder-path">
                    → {moduleFolderMap[m]}
                  </span>
                )}
                {!moduleFolderMap[m] && suggestedFolders[0] && (
                  <span className="pub-module-folder-path" style={{ opacity: 0.5 }}>
                    → {suggestedFolders[0]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* â”€â”€ Impact analysis â”€â”€ */}
      <div className="card pub-impact-card">
        <div className="pub-section-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={regrColor} strokeWidth="2" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h4>Impact Analysis</h4>
        </div>
        <div className="pub-impact-body">
          <div className="pub-impact-rec" style={{ borderColor: regrColor }}>
            <div className="pub-impact-verdict" style={{ color: regrColor }}>
              {addToRegr ? '⚠ Regression Recommended' : '✓ Smoke Test Sufficient'}
            </div>
            <p className="pub-impact-rec-title">{addToRegr ? 'Add to Regression Test Plan' : 'Add to Smoke Test Plan only'}</p>
            <p className="pub-impact-rec-reason">
              {highCount >= 1
                ? `${highCount} high-priority TC${highCount > 1 ? 's cover' : ' covers'} core functionality — regression risk is elevated`
                : `All test cases are ${lowCount === total ? 'low' : 'medium'} priority — smoke test coverage is sufficient`
              }
            </p>
          </div>
          <div className="pub-impact-bars">
            {[
              { label: 'High',   count: highCount,  color: '#e53935' },
              { label: 'Medium', count: medCount,   color: '#f59e0b' },
              { label: 'Low',    count: lowCount,   color: '#3b82f6' },
            ].map(r => (
              <div key={r.label} className="risk-row">
                <span className="risk-label">{r.label}</span>
                <div className="risk-track">
                  <div className="risk-fill" style={{ width: `${Math.round((r.count / maxPri) * 100)}%`, background: r.color }}/>
                </div>
                <span className="risk-count" style={{ color: r.color }}>{r.count} TC{r.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {publishError && (
        <div className="pub-error-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {publishError}
        </div>
      )}

      <div className="tcmd-actions">
        <button className="tcmd-btn tcmd-btn-secondary" onClick={onBack} disabled={publishing}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 7 }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to XRAY Analysis
        </button>
        <button className="tcmd-btn tcmd-btn-primary" onClick={handlePublish}
          disabled={!canPublish || publishing}
          title={!canPublish ? 'Select a target folder first' : ''}>
          {publishing
            ? <><span className="pub-spinner"/>Publishing…</>
            : <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 7 }}>
                  <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
                Confirm &amp; Publish {total} TC{total !== 1 ? 's' : ''} to XRAY
              </>
          }
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Publish Result page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function PublishResult({ publishResult, analyzeData, onDone, onViewDashboard, onGoToRegression }) {
  const { created = [], errors = [], summary = {}, impact_analysis = {} } = publishResult;
  const jiraBaseUrl  = publishResult.jira_base_url || analyzeData?.jira_base_url || 'https://hyland.atlassian.net';
  const xrayLink     = (key) => key ? `${jiraBaseUrl}/browse/${key}` : null;
  const successCount = created.length;
  const errorCount   = errors.length;
  const addToRegr    = impact_analysis.add_to_regression;
  const regrColor    = addToRegr ? '#e53935' : '#10b870';
  const maxPri       = Math.max(
    impact_analysis.high_priority_count || 0,
    impact_analysis.medium_priority_count || 0,
    impact_analysis.low_priority_count || 0, 1
  );
  const allOk = errorCount === 0;

  const pipelineSteps = [
    { icon: '🎫', label: 'JIRA Card', sub: summary.jira_id || '—' },
    { icon: '📂', label: 'TFS Changeset', sub: analyzeData?.tfs?.changeset_id || '—' },
    { icon: '🤖', label: 'AI Analysis', sub: `${(analyzeData?.generated_test_cases || []).length} TCs generated` },
    { icon: '✅', label: 'XRAY Published', sub: `${successCount} created` },
  ];

  return (
    <div className="pub-page">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="pub-result-wow">
        <div className={`pub-result-wow-icon${allOk ? '' : ' pub-result-wow-partial-icon'}`}>
          {allOk
            ? <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b870" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          }
        </div>
        <h2>{allOk ? `🎯 ${successCount} Test Case${successCount !== 1 ? 's' : ''} Live in XRAY Cloud` : `⚠ ${successCount} Created · ${errorCount} Failed`}</h2>
        <p>
          Linked to <strong style={{ color: '#fff' }}>{summary.jira_id}</strong> — {summary.jira_title}
          {summary.folder && <span style={{ display: 'block', marginTop: 4, fontSize: 12 }}>📂 {summary.folder}</span>}
        </p>
        <div className="pub-result-pipeline" style={{ marginTop: 20 }}>
          {pipelineSteps.map((s, i) => (
            <Fragment key={s.label}>
              <div className="pub-result-pipeline-step done">
                <span className="pip-icon">{s.icon}</span>
                <div><div className="pip-label">{s.label}</div><div className="pip-sub">{s.sub}</div></div>
              </div>
              {i < pipelineSteps.length - 1 && <span className="pub-result-pipeline-arrow">→</span>}
            </Fragment>
          ))}
        </div>
      </div>

      {/* â”€â”€ Stat cards â”€â”€ */}
      <div className="pub-result-stat-row">
        <div className="pub-result-stat"><div className="pub-result-stat-num" style={{ color: '#10b870' }}>{successCount}</div><div className="pub-result-stat-label">Tests Created</div></div>
        <div className="pub-result-stat"><div className="pub-result-stat-num" style={{ color: errorCount > 0 ? '#e53935' : '#a0a3b1' }}>{errorCount}</div><div className="pub-result-stat-label">Errors</div></div>
        <div className="pub-result-stat"><div className="pub-result-stat-num" style={{ color: '#5b6cff' }}>{(summary.modules || []).length}</div><div className="pub-result-stat-label">Modules</div></div>
        <div className="pub-result-stat"><div className="pub-result-stat-num" style={{ color: addToRegr ? '#e53935' : '#10b870', fontSize: 16, paddingTop: 6 }}>{addToRegr ? '⚠ HIGH' : '✓ LOW'}</div><div className="pub-result-stat-label">Regression Risk</div></div>
      </div>

      {/* â”€â”€ Created TC table â”€â”€ */}
      <div className="card pub-tc-card">
        <div className="pub-section-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b870" strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>
          <h4 style={{ color: '#10b870' }}>Created XRAY Test Cases ({successCount})</h4>
          <span className="ai-tc-source-badge" style={{ background: 'rgba(16,184,112,0.10)', color: '#10b870', border: '1px solid rgba(16,184,112,0.25)' }}>Linked to {summary.jira_id}</span>
        </div>
        <div className="xray-gap-table-wrap">
          <table className="xray-gap-table pub-tc-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ width: 72 }}>Gen. ID</th>
                <th>Title</th>
                <th style={{ width: 120 }}>XRAY Key</th>
                <th style={{ width: 130 }}>Module</th>
                <th style={{ width: 88 }}>Priority</th>
                <th>Folder</th>
              </tr>
            </thead>
            <tbody>
              {created.map((tc, i) => (
                <tr key={i} className="xray-gap-row xray-row-covered">
                  <td className="xray-gt-num">{i + 1}</td>
                  <td><span className="xray-tc-id" style={{ background: 'rgba(16,184,112,0.12)', color: '#10b870' }}>{tc.tc_id}</span></td>
                  <td className="xray-gt-title">{tc.title}</td>
                  <td>
                    {tc.xray_key
                      ? <a className="xray-ref-key xray-ref-link" href={xrayLink(tc.xray_key)} target="_blank" rel="noreferrer">{tc.xray_key}</a>
                      : <span className="xray-ref-dash">—</span>}
                  </td>
                  <td><span className="xray-tc-module-chip">{tc.module || '—'}</span></td>
                  <td><span className={`xray-priority-chip ${(tc.priority || 'Medium').toLowerCase()}`}>{tc.priority}</span></td>
                  <td className="xray-gt-folder"><BreadcrumbPath path={tc.folder} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* â”€â”€ Errors â”€â”€ */}
      {errorCount > 0 && (
        <div className="card pub-errors-card">
          <div className="pub-section-hdr">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <h4 style={{ color: '#e53935' }}>Failed to Create ({errorCount})</h4>
          </div>
          {errors.map((e, i) => (
            <div key={i} className="pub-error-row">
              <span className="xray-tc-id">{e.tc_id}</span>
              <span className="pub-error-msg">{e.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* â”€â”€ Impact analysis â”€â”€ */}
      <div className="card pub-impact-card">
        <div className="pub-section-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={regrColor} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <h4>Impact Analysis &amp; Recommendation</h4>
        </div>
        <div className="pub-impact-body">
          <div className="pub-impact-rec" style={{ borderColor: regrColor }}>
            <div className="pub-impact-verdict" style={{ color: regrColor }}>{addToRegr ? '⚠ Regression Recommended' : '✓ Smoke Test Sufficient'}</div>
            <p className="pub-impact-rec-title">{impact_analysis.recommendation}</p>
            <ul className="pub-impact-reasons">{(impact_analysis.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div className="pub-impact-bars">
            {[
              { label: 'High',   count: impact_analysis.high_priority_count   || 0, color: '#e53935' },
              { label: 'Medium', count: impact_analysis.medium_priority_count || 0, color: '#f59e0b' },
              { label: 'Low',    count: impact_analysis.low_priority_count    || 0, color: '#3b82f6' },
            ].map(r => (
              <div key={r.label} className="risk-row">
                <span className="risk-label">{r.label}</span>
                <div className="risk-track"><div className="risk-fill" style={{ width: `${Math.round((r.count / maxPri) * 100)}%`, background: r.color }}/></div>
                <span className="risk-count" style={{ color: r.color }}>{r.count} TC{r.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* â”€â”€ Modules â”€â”€ */}
      {(summary.modules || []).length > 0 && (
        <div className="card pub-modules-card">
          <div className="pub-section-hdr">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            <h4>Modules Affected</h4>
          </div>
          <div className="pub-modules-list">{summary.modules.map((m, i) => <span key={i} className="pub-module-chip">{m}</span>)}</div>
        </div>
      )}

      {/* â”€â”€ Actions â”€â”€ */}
      <div className="tcmd-actions">
        <button className="tcmd-btn tcmd-btn-secondary" onClick={onDone}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 7 }}><polyline points="15 18 9 12 15 6"/></svg>
          Analyze Another Card
        </button>
        <button className="tcmd-btn tcmd-btn-secondary" onClick={onViewDashboard}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 7 }}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          View Coverage Dashboard
        </button>
        <button className="tcmd-btn tcmd-btn-primary" onClick={onGoToRegression}
          style={{ background: 'linear-gradient(135deg,#5b6cff,#7c3aed)', gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
          </svg>
          Proceed to Regression Suite →
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Coverage Dashboard helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function CovModuleBar({ pct }) {
  const color = pct >= 70 ? '#10b870' : pct >= 40 ? '#f59e0b' : '#e53935';
  return (
    <div className="cov-bar-track">
      <div className="cov-bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function _fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/* â”€â”€ Coverage Dashboard page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function CoverageDashboard({ analyzeData, historyLog }) {
  const jiraBaseUrl = analyzeData?.jira_base_url || 'https://hyland.atlassian.net';
  const xrayLink = (key) => key ? `${jiraBaseUrl}/browse/${key}` : null;
  const generatedTCs = analyzeData?.generated_test_cases || [];
  const xray         = analyzeData?.xray         || {};
  const tfs          = analyzeData?.tfs          || {};
  const jiraInfo     = analyzeData?.jira         || {};
  const missing      = xray.missing  || [];
  const existing     = xray.existing || [];
  const xrayFolders  = xray.folders  || [];

  const totalTCs      = generatedTCs.length;
  const coveredCount  = existing.length;
  const missingCount  = missing.length;
  const coveragePct   = totalTCs > 0 ? Math.round((coveredCount / totalTCs) * 100) : 0;
  const highCount     = generatedTCs.filter(tc => tc.priority === 'High').length;
  const mediumCount   = generatedTCs.filter(tc => tc.priority === 'Medium').length;
  const lowCount      = generatedTCs.filter(tc => tc.priority === 'Low').length;
  const riskLevel     = highCount > 0 && missingCount > 0 ? 'High' : mediumCount > 0 && missingCount > 0 ? 'Medium' : 'Low';
  const riskColor     = riskLevel === 'High' ? '#e53935' : riskLevel === 'Medium' ? '#f59e0b' : '#10b870';

  // Module coverage: count generated and covered TCs per module
  const moduleMap = {};
  generatedTCs.forEach(tc => {
    const m = tc.module || 'General';
    if (!moduleMap[m]) moduleMap[m] = { name: m, total: 0, covered: 0 };
    moduleMap[m].total++;
  });
  existing.forEach(tc => {
    const m = tc.module || 'General';
    if (!moduleMap[m]) moduleMap[m] = { name: m, total: 0, covered: 0 };
    moduleMap[m].covered++;
  });
  const moduleCoverage = Object.values(moduleMap).map(m => ({
    ...m,
    pct: m.total > 0 ? Math.round((m.covered / m.total) * 100) : 0,
  })).sort((a, b) => b.pct - a.pct);

  const totalModules  = moduleCoverage.length;
  const hasData       = totalTCs > 0;

  // Risk bar widths relative to total
  const maxRisk = Math.max(highCount, mediumCount, lowCount, 1);

  const log = historyLog || [];

  if (!hasData) {
    return (
      <div className="coverage-page">
        <div className="covdash-header">
          <div>
            <h2 className="covdash-title">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '10px', verticalAlign: 'middle' }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
              Coverage Dashboard
            </h2>
            <p className="covdash-sub">Run an analysis on the JIRA Analysis tab to populate this dashboard</p>
          </div>
        </div>
        <div className="empty-state"><div className="empty-state-inner">
          <div className="empty-state-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c0c4e0" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg></div>
          <h3>No Analysis Data Yet</h3>
          <p>Go to <strong>JIRA Analysis</strong> → fetch a card → click <strong>Analyze the Impact Areas</strong>.</p>
        </div></div>
      </div>
    );
  }

  return (
    <div className="coverage-page">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="covdash-header">
        <div>
          <h2 className="covdash-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '10px', verticalAlign: 'middle' }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
            Coverage Dashboard
          </h2>
          <p className="covdash-sub">Real-time gap analysis coverage across all XRAY-mapped modules</p>
        </div>
        <div className="analysis-badges">
          <span className="badge-jira">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
            {jiraInfo.id || '—'}
          </span>
          {tfs.changeset_id && tfs.changeset_id !== 'N/A' && (
            <span className="badge-complete" style={{ background: '#e8f9ee', color: '#1a7a4a', borderColor: '#b2eac7' }}>
              CS-{tfs.changeset_id}
            </span>
          )}
          <span className="badge-complete" style={{
            background: riskLevel === 'High' ? '#fff0f0' : riskLevel === 'Medium' ? '#fffbeb' : '#e8f9ee',
            color: riskColor,
            borderColor: riskLevel === 'High' ? '#ffcdd2' : riskLevel === 'Medium' ? '#fde68a' : '#b2eac7',
          }}>
            {riskLevel} Risk
          </span>
        </div>
      </div>

      {/* â”€â”€ Metric cards â”€â”€ */}
      <div className="covdash-metrics">
        <div className="covdash-metric-card">
          <div className="cdm-icon" style={{ background: 'linear-gradient(135deg,#eef0ff,#dce0ff)', color: '#5b6cff' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <p className="cdm-label">XRAY Coverage</p>
            <h3 className="cdm-value" style={{ color: '#5b6cff' }}>{coveragePct}%</h3>
          </div>
        </div>
        <div className="covdash-metric-card">
          <div className="cdm-icon" style={{ background: 'linear-gradient(135deg,#e8f9ee,#c8f5dc)', color: '#10b870' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <p className="cdm-label">Covered by XRAY</p>
            <h3 className="cdm-value" style={{ color: '#10b870' }}>{coveredCount}</h3>
          </div>
        </div>
        <div className="covdash-metric-card">
          <div className="cdm-icon" style={{ background: 'linear-gradient(135deg,#fff0f0,#ffd6d6)', color: '#e53935' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div>
            <p className="cdm-label">To Be Created</p>
            <h3 className="cdm-value" style={{ color: '#e53935' }}>{missingCount}</h3>
          </div>
        </div>
        <div className="covdash-metric-card">
          <div className="cdm-icon" style={{ background: 'linear-gradient(135deg,#fff8e1,#ffe082)', color: '#e65100' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div>
            <p className="cdm-label">Risk Level</p>
            <h3 className="cdm-value" style={{ color: riskColor }}>{riskLevel}</h3>
          </div>
        </div>
        <div className="covdash-metric-card">
          <div className="cdm-icon" style={{ background: 'linear-gradient(135deg,#eef0ff,#dce0ff)', color: '#5b6cff' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
          </div>
          <div>
            <p className="cdm-label">Modules Mapped</p>
            <h3 className="cdm-value" style={{ color: '#5b6cff' }}>{totalModules}</h3>
          </div>
        </div>
      </div>

      {/* â”€â”€ Coverage progress banner â”€â”€ */}
      <div className="covdash-progress-banner">
        <div className="covdash-progress-left">
          <span className="covdash-prog-label">{coveredCount} of {totalTCs} generated test cases already exist in XRAY</span>
          <span className="covdash-prog-sub">{missingCount} new test case{missingCount !== 1 ? 's' : ''} need to be created · {xrayFolders.length} XRAY folder{xrayFolders.length !== 1 ? 's' : ''} matched</span>
        </div>
        <div className="covdash-progress-ring">
          <svg viewBox="0 0 36 36" width="64" height="64">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e8eaf2" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15.9" fill="none"
              stroke={coveragePct >= 70 ? '#10b870' : coveragePct >= 40 ? '#f59e0b' : '#e53935'}
              strokeWidth="3.5"
              strokeDasharray={`${coveragePct} ${100 - coveragePct}`}
              strokeDashoffset="25"
              strokeLinecap="round"
            />
            <text x="18" y="20.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#1a1d2e">{coveragePct}%</text>
          </svg>
        </div>
      </div>

      <div className="covdash-body">
        {/* â”€â”€ Left: Module coverage bars â”€â”€ */}
        <div className="card covdash-panel">
          <div className="covdash-panel-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <h4>Module Coverage Breakdown</h4>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#888' }}>{totalModules} module{totalModules !== 1 ? 's' : ''}</span>
          </div>
          {moduleCoverage.map((m, i) => {
            const pctColor = m.pct >= 70 ? '#10b870' : m.pct >= 40 ? '#f59e0b' : '#e53935';
            return (
              <div key={i} className="cov-module-row">
                <div className="cov-module-meta">
                  <span className="cov-module-name">{m.name}</span>
                  <span className="cov-module-fraction">{m.covered}/{m.total}</span>
                </div>
                <div className="cov-bar-row">
                  <CovModuleBar pct={m.pct} />
                  <span className="cov-pct-label" style={{ color: pctColor }}>{m.pct}%</span>
                </div>
              </div>
            );
          })}

          {/* XRAY folder breakdown */}
          {xrayFolders.length > 0 && (
            <div className="covdash-xray-folders">
              <p className="covdash-xray-folders-title">XRAY Folders Matched</p>
              {xrayFolders.slice(0, 8).map((f, i) => {
                const parts = f.split('/').filter(Boolean);
                const leaf  = parts[parts.length - 1] || 'Root';
                const parent = parts.slice(0, -1).join(' › ');
                return (
                  <div key={i} className="covdash-xray-folder-row">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                    </svg>
                    {parent && <span className="covdash-xray-parent">{parent} ›</span>}
                    <span className="covdash-xray-leaf">{leaf}</span>
                  </div>
                );
              })}
              {xrayFolders.length > 8 && (
                <p style={{ fontSize: '11px', color: '#aaa', marginTop: '6px' }}>+{xrayFolders.length - 8} more folders</p>
              )}
            </div>
          )}
        </div>

        {/* â”€â”€ Right column â”€â”€ */}
        <div className="covdash-right-col">

          {/* Risk breakdown */}
          <div className="card covdash-panel">
            <div className="covdash-panel-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <h4>Risk Breakdown</h4>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#888' }}>{totalTCs} total TCs</span>
            </div>
            {[
              { label: 'High',   count: highCount,   cls: 'high',   color: '#e53935' },
              { label: 'Medium', count: mediumCount, cls: 'medium', color: '#f59e0b' },
              { label: 'Low',    count: lowCount,    cls: 'low',    color: '#3b82f6' },
            ].map(r => (
              <div key={r.label} className="risk-row">
                <span className="risk-label">{r.label}</span>
                <div className="risk-track">
                  <div className="risk-fill" style={{
                    width: `${Math.round((r.count / maxRisk) * 100)}%`,
                    background: r.color,
                  }}/>
                </div>
                <span className="risk-count" style={{ color: r.color }}>{r.count} TC{r.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>

          {/* TC Coverage donut detail */}
          <div className="card covdash-panel">
            <div className="covdash-panel-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b870" strokeWidth="2" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <h4>Gap Summary</h4>
            </div>
            <div className="covdash-gap-summary">
              <div className="covdash-gap-item covered">
                <span className="covdash-gap-count">{coveredCount}</span>
                <span className="covdash-gap-desc">Covered<br/>by XRAY</span>
              </div>
              <div className="covdash-gap-divider"/>
              <div className="covdash-gap-item missing">
                <span className="covdash-gap-count">{missingCount}</span>
                <span className="covdash-gap-desc">Need to<br/>be created</span>
              </div>
              <div className="covdash-gap-divider"/>
              <div className="covdash-gap-item total">
                <span className="covdash-gap-count">{totalTCs}</span>
                <span className="covdash-gap-desc">Total<br/>Generated</span>
              </div>
            </div>
            {existing.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <p style={{ fontSize: '11.5px', fontWeight: 600, color: '#555', marginBottom: '8px' }}>Covered TC details</p>
                {existing.map((tc, i) => (
                  <div key={i} className="covdash-existing-row">
                    <span className="xray-tc-id" style={{ background: 'rgba(16,184,112,0.10)', color: '#10b870', fontSize: '10px' }}>{tc.id}</span>
                    <span className="covdash-existing-title">{tc.title}</span>
                    <a className="xray-ref-key xray-ref-link" href={xrayLink(tc.match_key)} target="_blank" rel="noreferrer" style={{ fontSize: '10px', padding: '1px 6px' }}>{tc.match_key}</a>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session run history */}
          <div className="card covdash-panel">
            <div className="covdash-panel-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <h4>Session History</h4>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#888' }}>{log.length} run{log.length !== 1 ? 's' : ''}</span>
            </div>
            {log.length === 0 ? (
              <p style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '12px 0' }}>No previous runs this session</p>
            ) : (
              log.map((h, i) => {
                const hCov = h.xray?.existing?.length || 0;
                const hTot = h.generated_test_cases?.length || 0;
                const hPct = hTot > 0 ? Math.round((hCov / hTot) * 100) : 0;
                const isCurrent = i === 0;
                return (
                  <div key={i} className="push-history-row" style={isCurrent ? { background: 'rgba(91,108,255,0.04)', borderRadius: '8px', padding: '10px 8px', marginBottom: '4px' } : {}}>
                    <div className="push-history-left">
                      <span className="push-card-id">{h.jira?.id || '—'}</span>
                      <span className="push-date">{_fmtTime(h._timestamp)}</span>
                    </div>
                    <div className="push-history-right">
                      <span className="push-count">{hCov}/{hTot} covered</span>
                      <span className={`push-status-badge ${hPct === 100 ? 'complete' : hPct > 0 ? 'partial' : 'none'}`}>
                        {hPct}%
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* â”€â”€ XRAY Analysis page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
/* â”€â”€ XRAY helper: breadcrumb folder path â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function BreadcrumbPath({ path, dim }) {
  // Treat empty string, "/", or null/undefined as uncategorized
  const cleaned = (path || '').replace(/^\//, '').trim();
  if (!cleaned) {
    return <span className="xray-bc-root" style={dim ? { color: '#c0c4e0' } : {}}>Uncategorized</span>;
  }
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length === 0) {
    return <span className="xray-bc-root" style={dim ? { color: '#c0c4e0' } : {}}>Uncategorized</span>;
  }
  return (
    <div className={`xray-breadcrumb${dim ? ' xray-breadcrumb-dim' : ''}`}>
      {parts.map((p, i) => (
        <span key={i} className="xray-bc-segment">
          {i > 0 && <span className="xray-bc-sep">›</span>}
          <span className={i === parts.length - 1 ? 'xray-bc-leaf' : 'xray-bc-parent'}>{p}</span>
        </span>
      ))}
    </div>
  );
}

/* â”€â”€ XRAY helper: similarity progress bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function SimilarityBar({ pct, dim }) {
  const color = dim ? '#b0b4c8' : pct >= 40 ? '#10b870' : pct >= 20 ? '#f59e0b' : '#e53935';
  return (
    <div className={`sim-bar-wrap${dim ? ' sim-bar-dim' : ''}`}>
      <div className="sim-bar-track">
        <div className="sim-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <span className="sim-bar-pct" style={{ color }}>{pct}%</span>
    </div>
  );
}

/* â”€â”€ Page 3: XRAY Analysis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function XrayAnalysis({ onPushToXray, onSkipXray, onGoToRegression, analyzeData }) {
  const jiraBaseUrl = analyzeData?.jira_base_url || 'https://hyland.atlassian.net';
  const xrayLink = (key) => key ? `${jiraBaseUrl}/browse/${key}` : null;
  const [activeTab, setActiveTab]     = useState('all');
  const [selectedTCs, setSelectedTCs] = useState(() => new Set());

  const generatedTCs  = analyzeData?.generated_test_cases || [];
  const xray          = analyzeData?.xray || {};
  const missing       = xray.missing  !== undefined ? xray.missing  : generatedTCs;
  const existing      = xray.existing !== undefined ? xray.existing : [];
  const xrayFolders   = xray.folders  || [];

  const totalTests    = generatedTCs.length;
  const missingCount  = missing.length;
  const existingCount = existing.length;
  const coveragePct   = totalTests > 0 ? Math.round((existingCount / totalTests) * 100) : 0;

  // â”€â”€ Selection helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allMissingIds   = missing.map(tc => tc.id);
  const selectedCount   = selectedTCs.size;
  const allSelected     = missingCount > 0 && selectedCount === missingCount;
  const someSelected    = selectedCount > 0 && !allSelected;

  const toggleTC = (id) => setSelectedTCs(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedTCs(
    allSelected ? new Set() : new Set(allMissingIds)
  );

  // Reset selection when analyzeData changes
  const [prevData, setPrevData] = useState(analyzeData);
  if (analyzeData !== prevData) { setPrevData(analyzeData); setSelectedTCs(new Set()); }

  // Merge all TCs with gap status for the table
  // IMPORTANT: use xray.missing (has nearest_* fields) not raw generatedTCs
  const missingById   = Object.fromEntries(missing.map(m => [m.id, m]));
  const existingById  = Object.fromEntries(existing.map(e => [e.id, e]));
  const allRows = generatedTCs.map(tc => {
    const matchedExisting = existingById[tc.id];
    if (matchedExisting) {
      return { ...tc, ...matchedExisting, status: 'covered', match: matchedExisting };
    }
    // Spread nearest_* fields from xray.missing entry onto the row
    const missingEntry = missingById[tc.id] || {};
    return { ...tc, ...missingEntry, status: 'new', match: null };
  });
  const filteredRows = activeTab === 'missing'  ? allRows.filter(r => r.status === 'new')
                     : activeTab === 'existing' ? allRows.filter(r => r.status === 'covered')
                     : allRows;

  const priorityRank  = { High: 0, Medium: 1, Low: 2 };
  const sortedMissing = [...missing].sort(
    (a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1)
  );

  return (
    <div className="tcmd-page">
      {/* â”€â”€ Header â”€â”€ */}
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
            </svg>
            XRAY Gap Analysis
          </h2>
          <p>AI-generated test cases cross-referenced against the XRAY repository — coverage report</p>
        </div>
        <span className="ai-tc-source-badge" style={{ alignSelf: 'center', fontSize: '12px', padding: '4px 10px' }}>
          via Copilot Studio · XRAY Cloud
        </span>
      </div>

      {/* â”€â”€ Stats â”€â”€ */}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card green">
          <div className="stat-icon green-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <p>Generated</p><h2>{totalTests || '—'}</h2>
        </div>
        <div className="stat-card red">
          <div className="stat-icon red-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <p>To Be Created</p><h2>{missingCount || '—'}</h2>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          </div>
          <p>Existing Matches</p><h2>{existingCount}</h2>
        </div>
        <div className="stat-card orange">
          <div className="stat-icon orange-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
          </div>
          <p>Risk Level</p>
          <span className="risk-badge high">High</span>
        </div>
        <div className="stat-card stat-card-coverage">
          <p>XRAY Coverage</p>
          <h2>{coveragePct}%</h2>
          <div className="coverage-bar-track">
            <div className="coverage-bar-fill" style={{ width: `${coveragePct}%` }} />
          </div>
          <span className="coverage-bar-sub">{existingCount} of {totalTests} covered</span>
        </div>
      </div>

      {totalTests > 0 ? (
        <>
          {/* â”€â”€ Gap Analysis Report Table â”€â”€ */}
          <div className="card xray-gap-report">
            <div className="xray-gap-report-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" />
                <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="12" y2="16" />
              </svg>
              <h4>Gap Analysis Report</h4>
              {xrayFolders.length > 0 && (
                <span style={{ fontSize: '11px', color: '#7c7f94' }}>
                  {xray.candidates_count || 0} XRAY candidates searched · {xrayFolders.length} folder{xrayFolders.length !== 1 ? 's' : ''} matched
                </span>
              )}
              <div className="xray-gap-tabs">
                <button className={`xray-gap-tab ${activeTab === 'all'      ? 'active'    : ''}`} onClick={() => setActiveTab('all')}>All ({totalTests})</button>
                <button className={`xray-gap-tab new     ${activeTab === 'missing'  ? 'active new'    : ''}`} onClick={() => setActiveTab('missing')}>+ New ({missingCount})</button>
                <button className={`xray-gap-tab covered ${activeTab === 'existing' ? 'active covered' : ''}`} onClick={() => setActiveTab('existing')}>✔ Covered ({existingCount})</button>
              </div>
            </div>

            <div className="xray-gap-table-wrap">
              <table className="xray-gap-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      {/* master checkbox — only meaningful when new rows visible */}
                      {(activeTab === 'all' || activeTab === 'missing') && missingCount > 0 && (
                        <input
                          type="checkbox"
                          className="xray-cb"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleAll}
                          title="Select / deselect all new TCs"
                        />
                      )}
                    </th>
                    <th style={{ width: 28 }}>#</th>
                    <th style={{ width: 72 }}>TC ID</th>
                    <th>Test Case Title</th>
                    <th style={{ width: 90 }}>Module</th>
                    <th style={{ width: 80 }}>Priority</th>
                    <th style={{ width: 100 }}>Status</th>
                    <th style={{ width: 100 }}>XRAY Ref</th>
                    <th>XRAY Module Path</th>
                    <th style={{ width: 110 }}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => (
                    <tr
                      key={row.id}
                      className={`xray-gap-row ${row.status === 'covered' ? 'xray-row-covered' : 'xray-row-new'}${selectedTCs.has(row.id) ? ' xray-row-selected' : ''}`}
                      onClick={() => row.status === 'new' && toggleTC(row.id)}
                      style={row.status === 'new' ? { cursor: 'pointer' } : {}}
                    >
                      <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                        {row.status === 'new' && (
                          <input
                            type="checkbox"
                            className="xray-cb"
                            checked={selectedTCs.has(row.id)}
                            onChange={() => toggleTC(row.id)}
                          />
                        )}
                      </td>
                      <td className="xray-gt-num">{i + 1}</td>
                      <td><span className="xray-tc-id">{row.id}</span></td>
                      <td className="xray-gt-title">{row.title}</td>
                      <td>
                        <span className="xray-tc-module-chip">{row.module || '—'}</span>
                      </td>
                      <td>
                        <span className={`xray-priority-chip ${(row.priority || 'Medium').toLowerCase()}`}>{row.priority}</span>
                      </td>
                      <td>
                        {row.status === 'covered'
                          ? <span className="xray-status-chip covered">✔ Covered</span>
                          : <span className="xray-status-chip new">+ New</span>
                        }
                      </td>
                      <td>
                        {row.match
                          ? <a className="xray-ref-key xray-ref-link" href={xrayLink(row.match.match_key)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{row.match.match_key}</a>
                          : row.nearest_key
                            ? <a className="xray-ref-key xray-ref-near xray-ref-link" href={xrayLink(row.nearest_key)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="Nearest XRAY test (below match threshold)">≈ {row.nearest_key}</a>
                            : <span className="xray-ref-dash">—</span>
                        }
                      </td>
                      <td className="xray-gt-folder">
                        {row.match
                          ? <BreadcrumbPath path={row.match.match_folder} />
                          : row.nearest_folder
                            ? <BreadcrumbPath path={row.nearest_folder} dim />
                            : <span className="xray-ref-dash">—</span>
                        }
                      </td>
                      <td>
                        {row.match
                          ? <SimilarityBar pct={Math.round((row.match.similarity || 0) * 100)} />
                          : row.nearest_sim > 0
                            ? <SimilarityBar pct={Math.round(row.nearest_sim * 100)} dim />
                            : <span className="xray-ref-dash">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* â”€â”€ Missing TC detail cards with selection â”€â”€ */}
          {missingCount > 0 && (
            <div className="card xray-tc-list-card">
              <div className="xray-tc-list-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e53935" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <h4>New Test Cases — To Be Created ({missingCount})</h4>
                <span className="ai-tc-source-badge">AI Generated · Ready to Publish</span>
              </div>

              {/* Selection toolbar */}
              <div className="xray-select-toolbar">
                <label className="xray-select-all-label">
                  <input
                    type="checkbox"
                    className="xray-cb"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAll}
                  />
                  <span>{allSelected ? 'Deselect all' : `Select all ${missingCount} new test cases`}</span>
                </label>
                {selectedCount > 0 && (
                  <span className="xray-selection-pill">
                    {selectedCount} of {missingCount} selected
                  </span>
                )}
                {selectedCount > 0 && (
                  <button className="xray-clear-sel" onClick={() => setSelectedTCs(new Set())}>
                    Clear
                  </button>
                )}
              </div>

              {sortedMissing.map((tc, i) => {
                const isSelected = selectedTCs.has(tc.id);
                return (
                  <div
                    key={i}
                    className={`xray-tc-card xray-tc-card-selectable${isSelected ? ' xray-tc-card-checked' : ''}`}
                    onClick={() => toggleTC(tc.id)}
                  >
                    <div className="xray-tc-card-top">
                      <input
                        type="checkbox"
                        className="xray-cb xray-card-cb"
                        checked={isSelected}
                        onChange={() => toggleTC(tc.id)}
                        onClick={e => e.stopPropagation()}
                      />
                      <span className="xray-tc-id">{tc.id}</span>
                      <span className="xray-tc-title">{tc.title}</span>
                      <span className={`ct-badge ${tc.priority === 'High' ? 'ct-delete' : tc.priority === 'Low' ? 'ct-add' : 'ct-edit'}`}>{tc.priority}</span>
                      <span className="xray-tc-module-badge">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '3px', verticalAlign: 'middle' }}>
                          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                        </svg>
                        {tc.module}
                      </span>
                    </div>
                    <ol className="xray-tc-steps">
                      {tc.steps.map((s, si) => <li key={si}>{s}</li>)}
                    </ol>
                    <div className="xray-tc-expected">
                      <span className="xray-tc-expected-label">Expected:</span> {tc.expected}
                    </div>
                    {/* Nearest XRAY match info for new TCs */}
                    {tc.nearest_key && (
                      <div className="xray-tc-nearest">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#7c7f94" strokeWidth="2" style={{ flexShrink: 0 }}>
                          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span className="xray-nearest-label">Nearest XRAY:</span>
                        <a className="xray-ref-key xray-ref-near xray-ref-link" href={xrayLink(tc.nearest_key)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: '10px', padding: '1px 6px' }}>≈ {tc.nearest_key}</a>
                        <span className="xray-nearest-summary">{tc.nearest_summary}</span>
                        {tc.nearest_folder && <BreadcrumbPath path={tc.nearest_folder} dim />}
                        <SimilarityBar pct={Math.round(tc.nearest_sim * 100)} dim />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* â”€â”€ Existing (Covered) TC detail cards â”€â”€ */}
          {existingCount > 0 && (
            <div className="card xray-tc-list-card xray-covered-list">
              <div className="xray-tc-list-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b870" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <h4 style={{ color: '#10b870' }}>Already Covered in XRAY ({existingCount})</h4>
                <span className="ai-tc-source-badge" style={{ background: 'rgba(16,184,112,0.10)', color: '#10b870', border: '1px solid rgba(16,184,112,0.25)' }}>
                  XRAY Match Found
                </span>
              </div>
              {existing.map((tc, i) => (
                <div key={i} className="xray-tc-card xray-tc-card-covered">
                  <div className="xray-tc-card-top">
                    <span className="xray-tc-id" style={{ background: 'rgba(16,184,112,0.12)', color: '#10b870' }}>{tc.id}</span>
                    <span className="xray-tc-title">{tc.title}</span>
                    <span className={`ct-badge ${tc.priority === 'High' ? 'ct-delete' : tc.priority === 'Low' ? 'ct-add' : 'ct-edit'}`}>{tc.priority}</span>
                    <a className="xray-ref-key xray-ref-link" href={xrayLink(tc.match_key)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto' }}>{tc.match_key}</a>
                  </div>
                  <div className="xray-covered-meta">
                    <div className="xray-covered-path">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b870" strokeWidth="2" style={{ flexShrink: 0 }}>
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <BreadcrumbPath path={tc.match_folder} />
                    </div>
                    <div className="xray-covered-match-row">
                      <span className="xray-covered-match-label">Matched test:</span>
                      <span className="xray-covered-match-title">{tc.match_summary}</span>
                      <SimilarityBar pct={Math.round((tc.similarity || 0) * 100)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="empty-state" style={{ minHeight: '200px' }}>
          <div className="empty-state-inner">
            <h3>No test cases generated yet</h3>
            <p>Run <strong>Analyze the Impact Areas</strong> on Page 1 first.</p>
          </div>
        </div>
      )}

      <div className="tcmd-actions">
        <button className="tcmd-btn tcmd-btn-secondary" onClick={onSkipXray}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '7px' }}>
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          Go to Coverage Dashboard
        </button>
        <button
          className="tcmd-btn tcmd-btn-primary"
          onClick={() => onPushToXray(sortedMissing.filter(tc => selectedTCs.has(tc.id)))}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? 'Select at least one new test case to publish' : `Publish ${selectedCount} selected test case${selectedCount !== 1 ? 's' : ''} to XRAY`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '7px' }}>
            <polyline points="16 16 12 12 8 16" />
            <line x1="12" y1="12" x2="12" y2="21" />
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" />
          </svg>
          {selectedCount > 0
            ? `Publish ${selectedCount} Test Case${selectedCount !== 1 ? 's' : ''} to XRAY`
            : 'Publish Tests to XRAY'
          }
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Page: Regression Suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function RegressionSuite({ analyzeData, onGoToPublish, publishResult }) {
  // Post-publish mode: use already-published XRAY TCs from publishResult
  // Pre-publish mode: use xray.missing (TCs not yet in XRAY)
  const isPostPublish = !!(publishResult?.created?.length);

  const jiraId     = analyzeData?.jira?.id || '';
  const jiraTitle  = analyzeData?.jira?.title || '';
  const folder     = (analyzeData?.xray?.folders || [])[0] || '';

  // In post-publish mode, map publishResult.created to TC-like objects
  const rawTCs = isPostPublish
    ? (publishResult.created || []).map(c => ({
        id:       c.tc_id,
        title:    c.title,
        module:   c.module || 'General',
        priority: c.priority || 'Medium',
        steps:    [],
        expected: '',
        _issue_id: c.issue_id,
        _xray_key: c.xray_key,
      }))
    : (analyzeData?.xray?.missing || []);

  const tcs = rawTCs.map(_computeRegressionMeta);

  const [priorityFilter, setPriorityFilter] = useState('all');
  const [minScore, setMinScore]             = useState(0);
  const [regressionSet, setRegressionSet]   = useState(() => new Set());
  const [autoSelectAll, setAutoSelectAll]   = useState(false);
  const [testPlanKey, setTestPlanKey]       = useState('');
  const [testPlanIssueId, setTestPlanIssueId] = useState('');
  const [testPlans, setTestPlans]           = useState([]);
  const [plansLoading, setPlansLoading]     = useState(false);
  const [plansError, setPlansError]         = useState(null);
  const [syncing, setSyncing]               = useState(false);
  const [syncResult, setSyncResult]         = useState(null);
  const [showModal, setShowModal]           = useState(false);

  const project = jiraId ? jiraId.split('-')[0] : '';

  useEffect(() => {
    if (!project) return;
    setPlansLoading(true);
    setPlansError(null);
    fetch(`/api/xray/testplans/${encodeURIComponent(project)}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || `HTTP ${r.status}`)))
      .then(d => { setTestPlans(d.plans || []); })
      .catch(e => { setPlansError(String(e)); })
      .finally(() => setPlansLoading(false));
  }, [project]);

  const [prevData, setPrevData] = useState(analyzeData);
  if (analyzeData !== prevData) {
    setPrevData(analyzeData); setRegressionSet(new Set()); setSyncResult(null);
  }

  const filtered = tcs.filter(tc => {
    if (priorityFilter !== 'all' && tc.priority !== priorityFilter) return false;
    if ((tc.automation_score || 0) < minScore) return false;
    return true;
  });

  const handleAutoSelect = (val) => {
    setAutoSelectAll(val);
    setRegressionSet(val ? new Set(tcs.filter(t => t.automation_feasible).map(t => t.id)) : new Set());
  };

  const toggleTC = (id) => setRegressionSet(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const feasibleCount = tcs.filter(t => t.automation_feasible).length;
  const avgScore      = tcs.length > 0 ? Math.round(tcs.reduce((s, t) => s + (t.automation_score || 0), 0) / tcs.length) : 0;
  const regCount      = regressionSet.size;

  const reasonIcon = (reason) => {
    if (reason.includes('Deterministic')) return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
    );
    if (reason.includes('High impact')) return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    );
    if (reason.includes('Frequent')) return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
    );
    if (reason.includes('Edge')) return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
    );
    if (reason.includes('Stable')) return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    );
    return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>;
  };

  const handleSync = async () => {
    setShowModal(false);
    setSyncing(true);
    setSyncResult(null);
    const selectedTCs = tcs.filter(t => regressionSet.has(t.id));
    try {
      if (isPostPublish) {
        // TCs already in XRAY — just add label + test plan
        const issueIds = selectedTCs.map(t => t._issue_id).filter(Boolean);
        const res = await fetch('/api/regression/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jira_id: jiraId, issue_ids: issueIds, test_plan_key: testPlanKey.trim(), test_plan_issue_id: testPlanIssueId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
          throw new Error(err.detail || 'Link failed');
        }
        const data = await res.json();
        setSyncResult({ ok: true, data: { ...data, created: selectedTCs.map(t => ({ tc_id: t.id, title: t.title, xray_key: t._xray_key })), summary: { total_published: selectedTCs.length } } });
      } else {
        // Pre-publish: create TCs in XRAY then link
        const res = await fetch('/api/regression/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jira_id: jiraId, jira_title: jiraTitle, test_cases: selectedTCs, folder_path: folder, test_plan_key: testPlanKey.trim() }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
          throw new Error(err.detail || 'Sync failed');
        }
        setSyncResult({ ok: true, data: await res.json() });
      }
    } catch (e) {
      setSyncResult({ ok: false, error: e.message });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="tcmd-page">
      <div className="analysis-topbar">
        <div className="header">
          <h2>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ marginRight: '8px', verticalAlign: 'middle' }}>
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
            </svg>
            Regression Suite Selection
          </h2>
          <p>{isPostPublish ? `${tcs.length} test case${tcs.length !== 1 ? 's' : ''} published — select which to add to regression suite` : 'Recommended automation candidates for regression testing'}</p>
        </div>
        <span className="ai-tc-source-badge" style={{ alignSelf: 'center', fontSize: '12px', padding: '4px 10px' }}>Copilot Studio · JIRA</span>
      </div>

      <div className="stats" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card red">
          <div className="stat-icon red-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
          <p>Pending Test Cases</p><h2>{tcs.length || '—'}</h2>
        </div>
        <div className="stat-card orange">
          <div className="stat-icon orange-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <p>Avg. Automation</p><h2>{avgScore ? `${avgScore}%` : '—'}</h2>
        </div>
        <div className="stat-card green">
          <div className="stat-icon green-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>
          <p>Feasible for Regression</p><h2>{feasibleCount || '—'}</h2>
        </div>
        <div className="stat-card blue">
          <div className="stat-icon blue-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg></div>
          <p>Project</p><h2>{jiraId ? jiraId.split('-')[0] : '—'}</h2>
        </div>
        <div className="stat-card stat-card-coverage">
          <p>Connected to JIRA</p>
          <h2 style={{ fontSize: '18px', color: '#5b6cff' }}>{avgScore}% +</h2>
          <div className="coverage-bar-track"><div className="coverage-bar-fill" style={{ width: `${avgScore}%` }}/></div>
          <span className="coverage-bar-sub">{jiraId || 'No card loaded'}</span>
        </div>
      </div>

      {tcs.length === 0 ? (
        <div className="empty-state" style={{ minHeight: '200px' }}>
          <div className="empty-state-inner">
            <h3>No new test cases to assess</h3>
            <p>Run analysis first, or all generated TCs are already covered in XRAY.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="reg-info-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            AI-detected test cases recommended for automation and inclusion in regression suite, based on confidence score and feasibility analysis.
          </div>

          <div className="card regression-table-card">
            <div className="regression-table-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b6cff" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
              <h4>Pending Test Case Details</h4>
              <button className="reg-sync-btn" disabled={regCount === 0 || syncing} onClick={() => setShowModal(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                {syncing ? 'Syncing…' : `${isPostPublish ? 'Add to Regression Suite' : 'Sync Test Cases to JIRA'}${regCount > 0 ? ` (${regCount})` : ''}`}
              </button>
            </div>

            <div className="reg-filter-bar">
              <span className="reg-filter-label">Filter: Priority</span>
              <select className="reg-filter-select" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <span className="reg-filter-label" style={{ marginLeft: 8 }}>Filter by Confidence Score</span>
              <select className="reg-filter-select" value={minScore} onChange={e => setMinScore(Number(e.target.value))}>
                <option value={0}>All</option>
                <option value={50}>50%+</option>
                <option value={75}>75%+</option>
                <option value={85}>85%+</option>
              </select>
              <button className="reg-reset-btn" onClick={() => { setPriorityFilter('all'); setMinScore(0); }}>Reset filters</button>

              {/* Test Plan selector */}
              <div className="reg-plan-selector">
                <span className="reg-filter-label">Regression Test Plan:</span>
                {plansLoading ? (
                  <span className="reg-plans-loading">Loading plans…</span>
                ) : plansError ? (
                  <span className="reg-plans-error" title={plansError}>Failed to load plans</span>
                ) : (
                  <select
                    className="reg-plan-select"
                    value={testPlanKey}
                    onChange={e => {
                      const chosen = testPlans.find(p => p.key === e.target.value);
                      setTestPlanKey(e.target.value);
                      setTestPlanIssueId(chosen?.issue_id || '');
                    }}
                  >
                    <option value="">-- Select a Test Plan --</option>
                    {testPlans.map(p => (
                      <option key={p.key} value={p.key}>{p.key} · {p.summary}</option>
                    ))}
                  </select>
                )}
                {testPlanKey && (
                  <button className="reg-plan-clear" onClick={() => { setTestPlanKey(''); setTestPlanIssueId(''); }} title="Clear selection">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                )}
              </div>
            </div>

            <table className="regression-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Test Case Title</th>
                  <th style={{ width: 160 }}>Automation Feas/ability</th>
                  <th style={{ width: 200 }}>Reason</th>
                  <th style={{ width: 170 }}>Regression</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tc, i) => {
                  const inSet    = regressionSet.has(tc.id);
                  const barColor = tc.automation_score >= 80 ? '#10b870' : tc.automation_score >= 60 ? '#f59e0b' : '#e53935';
                  return (
                    <Fragment key={tc.id}>
                      <tr className="reg-row">
                        <td className="xray-gt-num">{i + 1}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span className="xray-tc-id">{tc.id}</span>
                            {tc._xray_key && (
                              <a className="xray-ref-key xray-ref-link" href={`${analyzeData?.jira_base_url || 'https://hyland.atlassian.net'}/browse/${tc._xray_key}`} target="_blank" rel="noreferrer" style={{ fontSize: '10px', padding: '1px 7px' }}>{tc._xray_key}</a>
                            )}
                            <span className="reg-tc-title">{tc.title}</span>
                          </div>
                          <div className="reg-tc-sub">
                            {tc.module && <span>{tc.module}</span>}
                            {tc.priority && <span style={{ marginLeft: 6 }}>· <span className={`xray-priority-chip ${(tc.priority || 'Medium').toLowerCase()}`} style={{ fontSize: '10px', padding: '1px 6px' }}>{tc.priority}</span></span>}
                          </div>
                        </td>
                        <td>
                          <div className="auto-feas-wrap">
                            <div className={`auto-feas-label ${tc.automation_feasible ? 'feasible' : 'not-feasible'}`}>
                              {tc.automation_feasible
                                ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                              }
                              <span>{tc.automation_feasible ? 'Automatable' : 'Manual only'}</span>
                              <span style={{ fontWeight: 800, color: barColor, marginLeft: 4 }}>{tc.automation_score}%</span>
                            </div>
                            <div className="auto-bar-track"><div className="auto-bar-fill" style={{ width: `${tc.automation_score}%`, background: barColor }}/></div>
                          </div>
                        </td>
                        <td>
                          <ul className="reg-reason-list">
                            {(tc.automation_reasons || []).map((r, ri) => (
                              <li key={ri} className="reg-reason-item">
                                <span style={{ color: '#5b6cff', flexShrink: 0 }}>{reasonIcon(r)}</span>
                                {r}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {inSet ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              <span className="reg-added-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> In Suite</span>
                              <button className="reg-remove-btn" onClick={() => toggleTC(tc.id)}>Remove</button>
                            </div>
                          ) : (
                            <button className="reg-add-btn" onClick={() => toggleTC(tc.id)}>Add to Regression Suite</button>
                          )}
                        </td>
                      </tr>
                      <tr className="reg-suggestion-row">
                        <td colSpan={5}>
                          <div className="reg-suggestion-content">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {tc.automation_feasible && tc.automation_approach ? (
                                <div style={{ fontSize: '12px', color: '#2d3a2e', lineHeight: 1.6, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 700, color: '#10b870', marginRight: 6 }}>✔ Automation Approach:</span>
                                  {tc.automation_approach}
                                </div>
                              ) : tc.not_feasible_reason ? (
                                <div style={{ fontSize: '12px', lineHeight: 1.6, marginBottom: 4 }}>
                                  <div><span style={{ fontWeight: 700, color: '#e53935', marginRight: 6 }}>✖ Not Automatable:</span><span style={{ color: '#555' }}>{tc.not_feasible_reason}</span></div>
                                  {tc.not_feasible_example && (
                                    <div style={{ marginTop: 5, padding: '7px 12px', background: 'rgba(229,57,53,0.05)', borderLeft: '3px solid rgba(229,57,53,0.4)', borderRadius: '0 6px 6px 0', color: '#666', fontStyle: 'italic', fontSize: '11.5px', lineHeight: 1.6 }}>
                                      <strong style={{ fontStyle: 'normal', color: '#e53935', marginRight: 4 }}>Example:</strong>{tc.not_feasible_example}
                                    </div>
                                  )}
                                </div>
                              ) : null}
                              <div style={{ fontSize: '11.5px', color: '#7c7f94', marginTop: 2 }}>
                                <strong>Suggestion:</strong> {tc.regression_candidate ? 'Add to regression suite' : 'Consider for smoke tests only'}
                              </div>
                            </div>
                            <label className="reg-toggle" style={{ flexShrink: 0, marginLeft: 16 }}>
                              <input type="checkbox" checked={inSet} onChange={() => toggleTC(tc.id)} />
                              <span className="reg-slider" />
                            </label>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>

            <div className="reg-auto-bar">
              <label className="reg-toggle">
                <input type="checkbox" checked={autoSelectAll} onChange={e => handleAutoSelect(e.target.checked)} />
                <span className="reg-slider" />
              </label>
              <span className="reg-auto-label" style={{ marginLeft: 8 }}>Auto select all feasible</span>
              <span className="reg-auto-count">({feasibleCount} automatable TC{feasibleCount !== 1 ? 's' : ''})</span>
            </div>

            {syncResult && (
              <div className="reg-sync-result">
                {syncResult.ok ? (
                  <div className="reg-sync-success">
                    <h4><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 6 }}><polyline points="20 6 9 17 4 12"/></svg>Synced to JIRA successfully</h4>
                    <p style={{ fontSize: '12px', color: '#444', margin: 0 }}>
                      {syncResult.data?.summary?.total_published || 0} TC{(syncResult.data?.summary?.total_published || 0) !== 1 ? 's' : ''} created in XRAY
                      {syncResult.data?.jira_label_added ? ' · "regression" label added to JIRA' : ''}
                      {syncResult.data?.test_plan_added ? ' · Added to test plan' : ''}
                    </p>
                    {(syncResult.data?.created || []).map((c, ci) => (
                      <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11.5px', color: '#555' }}>
                        <span className="xray-tc-id" style={{ background: 'rgba(16,184,112,.10)', color: '#10b870', fontSize: '10px' }}>{c.tc_id}</span>
                        <span>{c.title}</span>
                        {c.xray_key && <a className="xray-ref-key xray-ref-link" href={`${analyzeData?.jira_base_url || ''}/browse/${c.xray_key}`} target="_blank" rel="noreferrer" style={{ fontSize: '10px', padding: '1px 6px' }}>{c.xray_key}</a>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="reg-sync-error"><p style={{ fontSize: '12px', color: '#e53935', margin: 0 }}><strong>Sync failed:</strong> {syncResult.error}</p></div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: '440px' }}>
            <h3 className="modal-title">Sync {regCount} Test Case{regCount !== 1 ? 's' : ''} to JIRA?</h3>
            <p className="modal-desc">{isPostPublish ? 'This will:' : 'This will create test cases and then:'}</p>
            <ul style={{ fontSize: '13px', color: '#555', marginLeft: '20px', lineHeight: 1.8, marginBottom: '12px' }}>
              {!isPostPublish && <li>Create {regCount} test case{regCount !== 1 ? 's' : ''} in XRAY under <strong>{folder || 'selected folder'}</strong></li>}
              {isPostPublish && <li>Mark {regCount} already-published TC{regCount !== 1 ? 's' : ''} as regression candidates</li>}
              <li>Link them to JIRA card <strong>{jiraId}</strong></li>
              <li>Add <strong>"regression"</strong> label to the JIRA issue</li>
              {testPlanKey && <li>Add to regression test plan <strong>{testPlanKey}</strong></li>}
            </ul>
            <div className="modal-actions">
              <button className="modal-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="modal-confirm" onClick={handleSync}>Confirm Sync</button>
            </div>
          </div>
        </div>
      )}

      <div className="tcmd-actions">
        <button className="tcmd-btn tcmd-btn-secondary" onClick={onGoToPublish}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '7px' }}><polyline points="15 18 9 12 15 6"/></svg>
          {isPostPublish ? 'Back to Publish Result' : 'Back to XRAY Analysis'}
        </button>
      </div>
    </div>
  );
}

/* â”€â”€ Main App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function App() {
  const [loggedIn, setLoggedIn]       = useState(false);
  const [authUser, setAuthUser]       = useState(null);
  const [currentTab, setCurrentTab]   = useState('jira-analysis');
  const [jiraFetched, setJiraFetched] = useState(false);
  const [jiraData, setJiraData]       = useState(null);
  const [jiraLoading, setJiraLoading]   = useState(false);
  const [jiraError, setJiraError]       = useState(null);
  const [analyzeData, setAnalyzeData]   = useState(null);
  const [analyzing, setAnalyzing]       = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  const [historyLog, setHistoryLog]     = useState([]);
  const [publishTCs, setPublishTCs]     = useState([]);
  const [publishResult, setPublishResult] = useState(null);

  if (!loggedIn) {
    return <Login onLogin={(user) => { setAuthUser(user); setLoggedIn(true); }} />;
  }

  const handleLogout = () => {
    setLoggedIn(false);
    setAuthUser(null);
    setCurrentTab('jira-analysis');
    setJiraFetched(false);
    setJiraData(null);
    setJiraError(null);
    setAnalyzeData(null);
    setAnalyzeError(null);
  };

  const handleAnalyze = async () => {
    if (!jiraData) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira_id: jiraData.id,
          tfs_changeset_id: jiraData.tfs_id || 'N/A',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || 'Analysis failed');
      }
      const data = await res.json();
      setAnalyzeData(data);
      setHistoryLog(prev => [{ ...data, _timestamp: new Date().toISOString() }, ...prev]);
      // Stay on JIRA Analysis page — show inline results
      // User clicks 'View Full Analysis →' to go to page 2
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFetch = async (cardId) => {
    setJiraLoading(true);
    setJiraError(null);
    setJiraFetched(false);
    try {
      const res = await fetch(`/api/jira/${encodeURIComponent(cardId)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(err.detail || 'Failed to fetch JIRA card');
      }
      const data = await res.json();
      setJiraData(data);
      setJiraFetched(true);
    } catch (e) {
      setJiraError(e.message);
      setJiraFetched(false);
    } finally {
      setJiraLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        onLogout={handleLogout}
        authUser={authUser}
      />

      {/* â”€â”€ JIRA Analysis â”€â”€ */}
      {currentTab === 'jira-analysis' && (
        <div className="main">
          <div className="left">
            <LeftPanel
              onFetch={handleFetch}
              fetched={jiraFetched}
              loading={jiraLoading}
              error={jiraError}
              historyLog={historyLog}
              onViewAll={() => setCurrentTab('history')}
              onSelectRecent={(item) => {
                setAnalyzeData(item);
                setCurrentTab('coverage-dashboard');
              }}
            />
          </div>
          <div className="right">
            {jiraFetched ? (
              <JiraDetails
              onAnalyze={handleAnalyze}
              onViewAnalysis={() => setCurrentTab('test-case-module')}
              analyzing={analyzing}
              analyzeError={analyzeError}
              data={jiraData}
              analyzeData={analyzeData}
            />
            ) : (
              <div className="empty-state">
                <div className="empty-state-inner">
                  <div className="empty-state-icon">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c0c4e0" strokeWidth="1.5">
                      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                      <rect x="9" y="3" width="6" height="4" rx="1" />
                      <line x1="9" y1="12" x2="15" y2="12" />
                      <line x1="9" y1="16" x2="13" y2="16" />
                    </svg>
                  </div>
                  <h3>No JIRA Card Loaded</h3>
                  <p>Enter a JIRA Card ID or paste a description on the left, then click <strong>Fetch JIRA Card Details</strong> to begin.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* â”€â”€ Test Case & Module Details â”€â”€ */}
      {currentTab === 'test-case-module' && (
        <div className="main-full">
          <TestCaseModuleDetails
            onProceedToXray={() => setCurrentTab('coverage-dashboard')}
            analyzeData={analyzeData}
          />
        </div>
      )}

      {/* â”€â”€ XRAY Analysis â”€â”€ */}
      {currentTab === 'coverage-dashboard' && (
        <div className="main-full">
          <XrayAnalysis
            onPushToXray={(selectedTCs) => {
              setPublishTCs(selectedTCs);
              setPublishResult(null);
              setCurrentTab('publish-review');
            }}
            onSkipXray={() => setCurrentTab('history')}
            onGoToRegression={() => setCurrentTab('regression-suite')}
            analyzeData={analyzeData}
          />
        </div>
      )}

      {/* â”€â”€ Regression Suite â”€â”€ */}
      {currentTab === 'regression-suite' && (
        <div className="main-full">
          <RegressionSuite
            analyzeData={analyzeData}
            publishResult={publishResult}
            onGoToPublish={() => setCurrentTab(publishResult ? 'publish-result' : 'coverage-dashboard')}
          />
        </div>
      )}

      {/* â”€â”€ Publish Review â”€â”€ */}
      {currentTab === 'publish-review' && (
        <div className="main-full">
          <PublishReview
            tcsToPush={publishTCs}
            analyzeData={analyzeData}
            onBack={() => setCurrentTab('coverage-dashboard')}
            onPublished={(result) => {
              setPublishResult(result);
              setCurrentTab('publish-result');
            }}
          />
        </div>
      )}

      {/* â”€â”€ Publish Result â”€â”€ */}
      {currentTab === 'publish-result' && (
        <div className="main-full">
          <PublishResult
            publishResult={publishResult}
            analyzeData={analyzeData}
            onDone={() => setCurrentTab('jira-analysis')}
            onViewDashboard={() => setCurrentTab('history')}
            onGoToRegression={() => setCurrentTab('regression-suite')}
          />
        </div>
      )}

      {/* â”€â”€ Publish Report / Coverage Dashboard â”€â”€ */}
      {currentTab === 'history' && (
        <div className="main-full">
          <CoverageDashboard analyzeData={analyzeData} historyLog={historyLog} publishResult={publishResult} />
        </div>
      )}
    </div>
  );
}

export default App;
