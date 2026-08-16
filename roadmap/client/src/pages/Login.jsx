import { useState } from 'react';
import { useApp } from '../lib/store.jsx';

export function Login() {
  const { login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.status === 0 ? 'Cannot reach the server. Check your connection.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="card card-pad login-card">
        <div className="row" style={{ marginBottom: '0.75rem' }}>
          <span className="brand-mark" aria-hidden="true">🧭</span>
          <h1 style={{ margin: 0, fontSize: '1.25rem' }}>No-Degree Tech Roadmap</h1>
        </div>
        <p className="muted small">
          Eleven realistic routes into tech without a degree — what to learn, what it costs, and roughly how long it
          takes. Sign in to track where you are.
        </p>

        <form onSubmit={submit} style={{ marginTop: '1.25rem' }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              autoComplete="username"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="small" style={{ color: 'var(--danger)', marginTop: '0.75rem' }} role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="faint" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          Two accounts are seeded on first run: <span className="mono">eric@roadmap.local</span> and{' '}
          <span className="mono">matt@roadmap.local</span>. Passwords come from the ERIC_PASSWORD / MATT_PASSWORD
          environment variables.
        </p>
      </div>
    </div>
  );
}
