import { useState } from "react";

function Login({ onLogin }) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleLogin = async () => {
    const trimmed = email.trim();
    if (!trimmed) { setError('Please enter your email address'); return; }
    if (!trimmed.includes('@')) { setError('Please enter a valid email address'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Authentication failed');
      onLogin(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-topbar">
        <div className="login-topbar-inner">
          <div className="login-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span>GapGuard AI</span>
          </div>
        </div>
        <h1 className="login-topbar-title">GapGuard AI</h1>
        <p className="login-topbar-sub">Detect test coverage gaps · Map JIRA cards to XRAY · Add missing test cases with AI</p>
      </div>

      <div className="login-body">
        <div className="login-card">
          <h2 className="login-welcome">Welcome! 👋</h2>
          <p className="login-desc">
            Enter your Hyland email address to access GapGuard AI
          </p>

          <div className="login-form">
            <label className="login-label">Email Address:</label>
            <input
              className="login-input"
              type="email"
              placeholder="your.email@hyland.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
              disabled={loading}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="login-btn" onClick={handleLogin} disabled={loading}
            style={{ opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? 'Verifying…' : 'Get Started'}
          </button>

          <div className="login-tip">
            <span className="tip-icon">💡</span>
            <p>
              <strong>Tip:</strong> Access is restricted to authorized QA engineers. Use your Hyland email to sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;

