import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Bar, Empty } from '../components/common.jsx';
import { dollars, hours, relativeDate } from '../lib/format.js';

export function Shared() {
  const { user, updateUser } = useApp();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/shared').then(setData).catch(() => setData({ sharing: false, peers: [] }));
  }, [user?.shareProgress]);

  const enable = async () => {
    setBusy(true);
    try {
      await updateUser({ shareProgress: true });
      setData(await api.get('/shared'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="empty">Loading…</div>;

  if (!data.sharing) {
    return (
      <>
        <div className="page-head">
          <h1>Shared dashboard</h1>
          <p className="lede">
            Opt in and you can see each other's progress side by side. It works both ways — you only see people who are
            also sharing, and turning it off hides you again immediately.
          </p>
        </div>
        <div className="card card-pad center">
          <p className="muted">Accountability works better when someone can see whether you actually did the thing.</p>
          <button type="button" className="btn btn-primary" onClick={enable} disabled={busy}>
            Share my progress
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Shared dashboard</h1>
        <p className="lede">
          Everyone here has opted in. You can turn sharing off any time in <Link to="/profile">Profile</Link>.
        </p>
      </div>

      {data.peers.length <= 1 && (
        <div className="banner">
          <span aria-hidden="true">👋</span>
          <div>You're the only one sharing so far. Nudge the other account to switch it on.</div>
        </div>
      )}

      <div className="grid grid-2">
        {data.peers.map((peer) => (
          <div className="card card-pad" key={peer.id}>
            <div className="row-between">
              <h2 style={{ margin: 0 }}>
                {peer.displayName} {peer.isYou && <span className="tag tag-accent">You</span>}
              </h2>
              <span className="faint">{relativeDate(peer.lastProgressAt)}</span>
            </div>

            <div className="grid grid-auto" style={{ marginTop: '0.85rem' }}>
              <div className="stat">
                <div className="stat-value">{peer.totals.completed}</div>
                <div className="stat-label">Steps</div>
              </div>
              <div className="stat">
                <div className="stat-value">{hours(peer.totals.hours)}</div>
                <div className="stat-label">Logged</div>
              </div>
              <div className="stat">
                <div className="stat-value">{dollars(peer.totals.spent)}</div>
                <div className="stat-label">Spent</div>
              </div>
              <div className="stat">
                <div className="stat-value">{peer.totals.badges}</div>
                <div className="stat-label">Badges</div>
              </div>
            </div>

            <h3 style={{ marginTop: '1rem' }}>Paths</h3>
            {peer.paths.length === 0 ? (
              <p className="faint">Nothing started yet.</p>
            ) : (
              <div className="stack-sm">
                {peer.paths.map((path) => (
                  <div key={path.pathId}>
                    <div className="row-between small">
                      <Link to={`/paths/${path.pathId}`}>{path.name}</Link>
                      <span className="faint">{path.percent}%</span>
                    </div>
                    <Bar percent={path.percent} />
                  </div>
                ))}
              </div>
            )}

            {peer.recentBadges.length > 0 && (
              <div className="row" style={{ marginTop: '0.85rem' }}>
                {peer.recentBadges.map((badge) => (
                  <span className="tag" key={badge.id} title={badge.description}>
                    {badge.icon} {badge.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {data.peers.length === 0 && <Empty title="Nobody is sharing yet" />}
    </>
  );
}
