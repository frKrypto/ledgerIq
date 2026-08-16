import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { dollars, hours } from '../lib/format.js';

export function Profile() {
  const { user, updateUser, logout, badges, summary, paths, progressByStep, theme, setTheme, pendingCount, flushOutbox } = useApp();
  const [headline, setHeadline] = useState(user?.headline || '');
  const [weeklyHours, setWeeklyHours] = useState(user?.weeklyHours || 8);
  const [nudgeDays, setNudgeDays] = useState(user?.nudgeDays ?? 7);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const allBullets = useMemo(() => {
    const out = [];
    for (const path of paths) {
      for (const step of path.steps) {
        if (progressByStep.get(step.id)?.status === 'done' && step.resumeBullet) {
          out.push({ pathName: path.name, bullet: step.resumeBullet });
        }
      }
    }
    return out;
  }, [paths, progressByStep]);

  const earned = badges.filter((b) => b.earned);
  const portfolioUrl = user?.portfolioSlug ? `${window.location.origin}/p/${user.portfolioSlug}` : null;

  const save = async () => {
    await updateUser({ headline, weeklyHours, nudgeDays });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <div className="page-head">
        <h1>Profile</h1>
        <p className="lede">{user?.displayName} · {user?.email}</p>
      </div>

      <div className="grid grid-2">
        <div className="card card-pad">
          <h2>Settings</h2>

          <div className="field">
            <label htmlFor="headline">Headline (shows on your public portfolio)</label>
            <input
              id="headline"
              value={headline}
              placeholder="Working toward my first IT support role"
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="weekly">Hours available per week: {weeklyHours}</label>
            <input id="weekly" type="range" min="1" max="40" value={weeklyHours} onChange={(e) => setWeeklyHours(Number(e.target.value))} />
          </div>

          <div className="field">
            <label htmlFor="nudge">Nudge me if I log nothing for (days)</label>
            <input id="nudge" type="number" min="0" max="90" value={nudgeDays} onChange={(e) => setNudgeDays(Number(e.target.value))} />
            <div className="faint">0 turns the nudge off. It appears on your dashboard — nothing is emailed anywhere.</div>
          </div>

          <div className="field">
            <label htmlFor="theme">Theme</label>
            <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">Match my device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="field">
            <label>Sharing</label>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => updateUser({ shareProgress: !user.shareProgress })}
            >
              {user?.shareProgress ? '✓ Progress visible on the shared dashboard' : 'Share my progress'}
            </button>
          </div>

          <div className="row" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={save}>{saved ? 'Saved' : 'Save settings'}</button>
            <button type="button" className="btn" onClick={logout}>Sign out</button>
          </div>

          {pendingCount > 0 && (
            <p className="faint" style={{ marginTop: '0.75rem' }}>
              {pendingCount} offline change{pendingCount === 1 ? '' : 's'} waiting.{' '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={flushOutbox}>Sync now</button>
            </p>
          )}
        </div>

        <div className="card card-pad">
          <h2>Public portfolio</h2>
          <p className="muted small">
            A shareable page listing your completed certs, projects, and badges — something to paste into a job
            application. It shows only completed steps and never your email address.
          </p>

          <button
            type="button"
            className={`btn btn-sm${user?.portfolioPublic ? '' : ' btn-primary'}`}
            onClick={() => updateUser({ portfolioPublic: !user.portfolioPublic })}
          >
            {user?.portfolioPublic ? '✓ Published — click to unpublish' : 'Publish my portfolio'}
          </button>

          {user?.portfolioPublic && portfolioUrl && (
            <div style={{ marginTop: '0.85rem' }}>
              <div className="mono small" style={{ wordBreak: 'break-all' }}>{portfolioUrl}</div>
              <div className="row" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(portfolioUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <Link className="btn btn-sm" to={`/p/${user.portfolioSlug}`}>Preview</Link>
              </div>
            </div>
          )}

          <h3 style={{ marginTop: '1.25rem' }}>Totals</h3>
          <div className="grid grid-auto">
            <div className="stat"><div className="stat-value">{summary.totalCompleted}</div><div className="stat-label">Steps done</div></div>
            <div className="stat"><div className="stat-value">{hours(summary.totalHours)}</div><div className="stat-label">Logged</div></div>
            <div className="stat"><div className="stat-value">{dollars(summary.totalSpent)}</div><div className="stat-label">Spent</div></div>
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: '1.75rem' }}>Resume bullets ({allBullets.length})</h2>
      <div className="card card-pad">
        {allBullets.length === 0 ? (
          <p className="muted">Complete steps and the resume-ready wording collects here, across every path.</p>
        ) : (
          <>
            <ul className="small">
              {allBullets.map(({ bullet, pathName }) => (
                <li key={bullet} style={{ marginBottom: '0.35rem' }}>
                  {bullet} <span className="faint">— {pathName}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigator.clipboard?.writeText(allBullets.map((b) => `• ${b.bullet}`).join('\n'))}
            >
              Copy all bullets
            </button>
          </>
        )}
      </div>

      <h2 style={{ marginTop: '1.75rem' }}>Badges ({earned.length} of {badges.length})</h2>
      <div className="badge-grid">
        {badges.map((badge) => (
          <div className={`badge${badge.earned ? '' : ' locked'}`} key={badge.id}>
            <div className="badge-icon" aria-hidden="true">{badge.icon}</div>
            <div className="badge-name">{badge.name}</div>
            <div className="badge-desc">{badge.description}</div>
          </div>
        ))}
      </div>
    </>
  );
}
