import { useRef, useState } from 'react';

const PRIORITY_COLOR = { Highest: '#e53e3e', High: '#dd6b20', Medium: '#d69e2e', Low: '#38a169', Lowest: '#718096' };
const STATUS_COLOR   = { 'To Do': '#718096', 'In Progress': '#3182ce', 'Done': '#38a169', 'In Review': '#805ad5' };

function _relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h !== 1 ? 's' : ''} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7)  return `${d} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function LeftPanel({ onFetch, fetched, loading, error, historyLog = [], onViewAll, onSelectRecent }) {
  const cardIdRef   = useRef(null);
  const [project,        setProject]        = useState('');
  const [descText,       setDescText]       = useState('');
  const [searchResults,  setSearchResults]  = useState([]);
  const [searchLoading,  setSearchLoading]  = useState(false);
  const [searchError,    setSearchError]    = useState('');
  const recentItems = historyLog.slice(0, 5);

  const handleClick = () => {
    const cardId = cardIdRef.current?.value?.trim();
    if (!cardId) {
      cardIdRef.current?.focus();
      return;
    }
    onFetch(cardId);
  };

  const handleSearch = async () => {
    const q = descText.trim();
    if (q.length < 3) return;
    setSearchLoading(true);
    setSearchError('');
    setSearchResults([]);
    try {
      const params = new URLSearchParams({ q });
      if (project) params.set('project', project);
      let res = await fetch(`/api/jira/search?${params}`);
      let data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Search failed');

      // If phrase match returned nothing, retry as keyword search (append &fallback=1)
      if ((data.results || []).length === 0 && q.trim().split(/\s+/).length > 1) {
        const params2 = new URLSearchParams({ q, fallback: '1' });
        if (project) params2.set('project', project);
        const res2 = await fetch(`/api/jira/search?${params2}`);
        const data2 = await res2.json();
        if (res2.ok) data = data2;
      }

      setSearchResults(data.results || []);
      if ((data.results || []).length === 0) setSearchError('No matching cards found.');
    } catch (e) {
      setSearchError(e.message || 'Search error');
    } finally {
      setSearchLoading(false);
    }
  };

  const handlePickResult = (id) => {
    setSearchResults([]);
    setDescText('');
    setSearchError('');
    onFetch(id);
  };

  return (
    <div className="card left-panel-card">
      <div className="left-panel-header">
        <span className="left-panel-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
            <rect x="9" y="3" width="6" height="4" rx="1" />
          </svg>
        </span>
        <div>
          <h3>Enter JIRA Card Details</h3>
          <p className="subtext">Pick a JIRA card from your project or paste details</p>
        </div>
      </div>

      <div className="form-group">
        <div className="select-wrapper">
          <select className="select-input" value={project} onChange={e => setProject(e.target.value)}>
            <option value="">Select a project...</option>
            <option>SBPWC</option>
            <option>WV</option>
            <option>DOC</option>
          </select>
          <span className="select-arrow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">JIRA Card ID</label>
        <input
          ref={cardIdRef}
          className="input"
          placeholder="e.g., SBPWC-10999"
        />
      </div>

      <div className="or-divider">
        <span className="or-line" />
        <span className="or-text">or</span>
        <span className="or-line" />
      </div>

      <div className="form-group" style={{ position: 'relative' }}>
        <label className="form-label">Search by Description</label>
        <textarea
          className="textarea"
          placeholder="Type keywords from the JIRA description or title..."
          value={descText}
          onChange={e => { setDescText(e.target.value); setSearchResults([]); setSearchError(''); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSearch(); } }}
          rows={3}
        />
        <button
          onClick={handleSearch}
          disabled={searchLoading || descText.trim().length < 3}
          style={{
            marginTop: '6px', width: '100%', padding: '7px 14px',
            background: descText.trim().length >= 3 ? 'linear-gradient(135deg,#5b6cff,#7c3aed)' : '#e2e8f0',
            color: descText.trim().length >= 3 ? '#fff' : '#a0aec0',
            border: 'none', borderRadius: '7px', fontWeight: 600, fontSize: '13px',
            cursor: descText.trim().length >= 3 && !searchLoading ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            transition: 'all 0.2s',
          }}
        >
          {searchLoading ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{animation:'spin 1s linear infinite'}}>
                <path d="M21 12a9 9 0 11-6.219-8.56"/>
              </svg>
              Searching…
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              Find Matching Cards
            </>
          )}
        </button>

        {searchError && (
          <p style={{ fontSize: '12px', color: '#e53e3e', margin: '5px 0 0', textAlign: 'center' }}>{searchError}</p>
        )}

        {searchResults.length > 0 && (
          <div style={{
            marginTop: '8px', border: '1px solid #e2e8f0', borderRadius: '8px',
            overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}>
            <div style={{ padding: '6px 10px', background: '#f7f8fc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#718096', fontWeight: 600 }}>
              {searchResults.length} card{searchResults.length !== 1 ? 's' : ''} found — click to load
            </div>
            {searchResults.map(r => (
              <div
                key={r.id}
                onClick={() => handlePickResult(r.id)}
                style={{
                  padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f5',
                  transition: 'background 0.15s', background: '#fff',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <span style={{
                    fontSize: '11px', fontWeight: 700, color: '#5b6cff',
                    background: '#eef0ff', padding: '1px 6px', borderRadius: '4px', whiteSpace: 'nowrap',
                  }}>{r.id}</span>
                  {r.status && (
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px',
                      background: (STATUS_COLOR[r.status] || '#718096') + '22',
                      color: STATUS_COLOR[r.status] || '#718096',
                    }}>{r.status}</span>
                  )}
                  {r.priority && (
                    <span style={{
                      fontSize: '10px', color: PRIORITY_COLOR[r.priority] || '#718096',
                      marginLeft: 'auto', whiteSpace: 'nowrap',
                    }}>● {r.priority}</span>
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#2d3748', lineHeight: 1.4 }}>{r.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="fetch-error-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:'7px',flexShrink:0}}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {fetched && !error && (
        <div className="fetch-success-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{marginRight:'7px',flexShrink:0}}>
            <polyline points="20 6 9 17 4 12" />
          </svg>
          JIRA card loaded — see details on the right
        </div>
      )}

      <button className="btn" onClick={handleClick} disabled={loading} style={{marginTop: (fetched || error) ? '10px' : '6px'}}>
        {loading ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:'8px',animation:'spin 1s linear infinite'}}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            Fetching…
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:'8px'}}>
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {fetched ? 'Re-fetch Card' : 'Fetch JIRA Card Details'}
          </>
        )}
      </button>

      <div className="recent">
        <div className="recent-header">
          <p className="recent-title">Recent Analyses</p>
          {historyLog.length > 0 && (
            <span className="view-all-link" onClick={onViewAll} style={{ cursor: 'pointer' }}>
              View All ({historyLog.length}) →
            </span>
          )}
        </div>
        {recentItems.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#aaa', margin: '8px 0 0', fontStyle: 'italic' }}>
            No analyses yet — fetch a JIRA card to get started
          </p>
        ) : (
          recentItems.map((item, i) => {
            const jiraId = item?.jira?.id || item?.jira_id || '—';
            const title  = item?.jira?.title || '';
            const ts     = item?._timestamp;
            return (
              <div key={i} className="recent-item"
                onClick={() => onSelectRecent && onSelectRecent(item)}
                title={title}
                style={{ cursor: onSelectRecent ? 'pointer' : 'default' }}>
                <span style={{ fontWeight: 600, color: '#1a1d2e' }}>{jiraId}</span>
                <span className="recent-time">{_relTime(ts)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default LeftPanel;