import { NavLink, Link, Outlet } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Celebration } from './Celebration.jsx';

const LINKS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/paths', label: 'Paths' },
  { to: '/compare', label: 'Compare' },
  { to: '/quiz', label: 'Find my path' },
  { to: '/schedule', label: 'Schedule' },
  { to: '/budget', label: 'Budget' },
  { to: '/library', label: 'No-PC' },
  { to: '/map', label: 'Pivots' },
  { to: '/shared', label: 'Shared' },
  { to: '/profile', label: 'Profile' },
];

export function Layout() {
  const { user, theme, setTheme, online, pendingCount } = useApp();

  const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  const themeIcon = { dark: '🌙', light: '☀️', system: '🖥️' }[theme];

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>

      <header className="masthead no-print">
        <div className="masthead-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">🧭</span>
            <span className="brand-text">No-Degree Tech Roadmap</span>
          </Link>

          <nav className="nav" aria-label="Main">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="masthead-actions">
            <button
              type="button"
              className="btn icon-btn"
              onClick={() => setTheme(nextTheme)}
              title={`Theme: ${theme}. Switch to ${nextTheme}.`}
              aria-label={`Theme: ${theme}. Switch to ${nextTheme}.`}
            >
              {themeIcon}
            </button>
            {user && (
              <span className="tag tag-accent nowrap" title={user.email}>
                {user.displayName}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="main" id="main">
        {!online && (
          <div className="banner banner-offline no-print">
            <span aria-hidden="true">📴</span>
            <div>
              <strong>Offline.</strong> The roadmap is cached and still works. Progress you record is saved on this
              device{pendingCount > 0 ? ` (${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting)` : ''} and syncs when you reconnect.
            </div>
          </div>
        )}
        {online && pendingCount > 0 && (
          <div className="banner no-print">
            <span aria-hidden="true">🔄</span>
            <div>Syncing {pendingCount} offline change{pendingCount === 1 ? '' : 's'}…</div>
          </div>
        )}
        <Outlet />
      </main>

      <Celebration />
    </div>
  );
}
