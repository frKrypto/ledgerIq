import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Bar, Empty } from '../components/common.jsx';
import { hours, shortDate } from '../lib/format.js';

/**
 * Public, unauthenticated page — the link you put on a job application.
 * Deliberately plain: certifications, projects, and evidence, in that order.
 */
export function Portfolio() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Portfolio pages are viewed by strangers on unknown devices, so respect
    // the device theme rather than the owner's saved preference.
    document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    api.get(`/portfolio/${slug}`).then(setData).catch((err) => setError(err.message));
  }, [slug]);

  if (error) {
    return (
      <div className="main">
        <Empty title="Nothing here">This portfolio is private or does not exist.</Empty>
      </div>
    );
  }
  if (!data) return <div className="empty">Loading…</div>;

  const Section = ({ title, items, empty }) =>
    items.length === 0 ? null : (
      <section style={{ marginTop: '1.75rem' }}>
        <h2>{title}</h2>
        <div className="stack-sm">
          {items.map((item) => (
            <div className="card card-pad" key={item.stepId}>
              <div className="row-between">
                <div>
                  <h3 style={{ margin: 0 }}>{item.title}</h3>
                  <span className="faint">{item.pathName}</span>
                </div>
                <span className="faint nowrap">{shortDate(item.completedAt)}</span>
              </div>
              {item.resumeBullet && <p className="small muted" style={{ margin: '0.5rem 0 0' }}>{item.resumeBullet}</p>}
            </div>
          ))}
        </div>
        {empty}
      </section>
    );

  return (
    <div className="main">
      <header className="card card-pad">
        <h1 style={{ marginBottom: '0.25rem' }}>{data.displayName}</h1>
        {data.headline && <p className="muted" style={{ margin: 0 }}>{data.headline}</p>}
        <div className="row" style={{ marginTop: '0.85rem' }}>
          <span className="tag tag-accent">{data.totals.completed} steps completed</span>
          <span className="tag">{hours(data.totals.hours)} logged</span>
          <span className="tag">{data.certifications.length} certifications</span>
          <span className="tag">{data.projects.length} projects</span>
        </div>
      </header>

      {data.paths.length > 0 && (
        <section style={{ marginTop: '1.75rem' }}>
          <h2>Training in progress</h2>
          <div className="stack-sm">
            {data.paths.map((path) => (
              <div key={path.pathId}>
                <div className="row-between small">
                  <strong>{path.name}</strong>
                  <span className="faint">{path.percent}% · {path.completedSteps}/{path.requiredSteps} steps</span>
                </div>
                <Bar percent={path.percent} />
              </div>
            ))}
          </div>
        </section>
      )}

      <Section title="Certifications" items={data.certifications} />
      <Section title="Projects" items={data.projects} />
      <Section title="Practical experience" items={data.experience} />
      <Section title="Skills completed" items={data.skills} />

      {data.badges.length > 0 && (
        <section style={{ marginTop: '1.75rem' }}>
          <h2>Milestones</h2>
          <div className="badge-grid">
            {data.badges.map((badge) => (
              <div className="badge" key={badge.id}>
                <div className="badge-icon" aria-hidden="true">{badge.icon}</div>
                <div className="badge-name">{badge.name}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="faint center" style={{ marginTop: '2.5rem' }}>
        Progress tracked with the No-Degree Tech Roadmap.
      </p>
    </div>
  );
}
