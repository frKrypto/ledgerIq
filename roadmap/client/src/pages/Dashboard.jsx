import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Bar, ProgressRing, Stat, Empty } from '../components/common.jsx';
import { dollars, hours, relativeDate } from '../lib/format.js';

export function Dashboard() {
  const { user, summary, badges, nudge, paths, pathsById } = useApp();

  const active = (summary.perPath || []).filter((p) => p.touched).sort((a, b) => b.percent - a.percent);
  const earned = badges.filter((b) => b.earned);
  const primary = user?.primaryPath ? pathsById.get(user.primaryPath) : null;

  return (
    <>
      <div className="page-head">
        <h1>Hey {user?.displayName}.</h1>
        <p className="lede">
          {active.length === 0
            ? 'Nothing started yet. Take the three-minute quiz, or just browse the paths and pick one — you can switch later without losing much.'
            : `${summary.totalCompleted} step${summary.totalCompleted === 1 ? '' : 's'} done, ${hours(
                summary.totalHours,
              )} logged, ${dollars(summary.totalSpent)} spent so far.`}
        </p>
      </div>

      {nudge && (
        <div className="banner banner-warn no-print">
          <span aria-hidden="true">⏰</span>
          <div>
            <strong>No progress logged in {nudge.daysIdle} days.</strong> That is not a failure — but if the plan has
            stopped fitting your week, adjust your hours in <Link to="/profile">Profile</Link> rather than abandoning it.
          </div>
        </div>
      )}

      <div className="grid grid-auto" style={{ marginBottom: '1.25rem' }}>
        <Stat value={summary.totalCompleted} label="Steps completed" />
        <Stat value={hours(summary.totalHours)} label="Hours logged" />
        <Stat value={dollars(summary.totalSpent)} label="Spent so far" />
        <Stat value={earned.length} label="Badges earned" />
      </div>

      {primary && (
        <div className="card card-pad" style={{ marginBottom: '1.25rem' }}>
          <div className="row-between">
            <div>
              <div className="stat-label">Your main path</div>
              <h2 style={{ margin: '0.15rem 0 0' }}>{primary.name}</h2>
              <p className="muted small" style={{ margin: '0.25rem 0 0' }}>{primary.avgTimeline}</p>
            </div>
            <ProgressRing percent={active.find((p) => p.pathId === primary.id)?.percent || 0} size={64} />
          </div>
          <div className="row" style={{ marginTop: '0.9rem' }}>
            <Link className="btn btn-primary btn-sm" to={`/paths/${primary.id}`}>Open roadmap</Link>
            <Link className="btn btn-sm" to="/schedule">Weekly plan</Link>
            <Link className="btn btn-sm" to={`/print/${primary.id}`}>Print view</Link>
          </div>
        </div>
      )}

      <h2>In progress</h2>
      {active.length === 0 ? (
        <div className="card card-pad">
          <Empty title="No path started yet">
            <div className="row" style={{ justifyContent: 'center', marginTop: '0.75rem' }}>
              <Link className="btn btn-primary" to="/quiz">Take the quiz</Link>
              <Link className="btn" to="/paths">Browse all {paths.length} paths</Link>
            </div>
          </Empty>
        </div>
      ) : (
        <div className="grid grid-2">
          {active.map((path) => (
            <Link key={path.pathId} to={`/paths/${path.pathId}`} className="card path-card">
              <div className="row-between">
                <h3>{path.name}</h3>
                <span className="tag tag-accent">{path.percent}%</span>
              </div>
              <Bar percent={path.percent} />
              <p className="faint" style={{ margin: 0 }}>
                {path.completedSteps} of {path.requiredSteps} required steps · {hours(path.hoursLogged)} logged · last
                activity {relativeDate(path.lastActivity)}
              </p>
            </Link>
          ))}
        </div>
      )}

      {earned.length > 0 && (
        <>
          <h2 style={{ marginTop: '1.75rem' }}>Recent badges</h2>
          <div className="badge-grid">
            {earned.slice(-6).reverse().map((badge) => (
              <div className="badge" key={badge.id}>
                <div className="badge-icon" aria-hidden="true">{badge.icon}</div>
                <div className="badge-name">{badge.name}</div>
                <div className="badge-desc">{badge.description}</div>
              </div>
            ))}
          </div>
          <p className="faint" style={{ marginTop: '0.5rem' }}>
            <Link to="/profile">See all badges</Link>
          </p>
        </>
      )}
    </>
  );
}
