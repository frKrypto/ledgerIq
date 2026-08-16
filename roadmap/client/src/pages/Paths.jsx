import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Bar, DifficultyTag } from '../components/common.jsx';
import { money, salary } from '../lib/format.js';

export function Paths() {
  const { paths, summary } = useApp();
  const [sort, setSort] = useState('recommended');

  const progressFor = (id) => summary.perPath?.find((p) => p.pathId === id);

  const sorted = [...paths].sort((a, b) => {
    if (sort === 'fastest') return a.totals.requiredHours - b.totals.requiredHours;
    if (sort === 'cheapest') return a.totals.requiredCost - b.totals.requiredCost;
    if (sort === 'salary') return b.salaryRange.max - a.salaryRange.max;
    if (sort === 'nopc') return b.totals.noPcSteps / b.totals.steps - a.totals.noPcSteps / a.totals.steps;
    return 0;
  });

  return (
    <>
      <div className="page-head">
        <h1>Career paths</h1>
        <p className="lede">
          Eleven routes that people genuinely take without a CS degree. They are ordered by how reachable the first job
          is — gentlest first. Every timeline and salary here is the realistic version, not the marketing one.
        </p>
      </div>

      <div className="filters no-print">
        <div className="row-between">
          <div className="filter-chips">
            {[
              ['recommended', 'Most reachable first'],
              ['fastest', 'Least study time'],
              ['cheapest', 'Cheapest'],
              ['salary', 'Highest ceiling'],
              ['nopc', 'Most phone-friendly'],
            ].map(([value, label]) => (
              <button key={value} type="button" className="chip" aria-pressed={sort === value} onClick={() => setSort(value)}>
                {label}
              </button>
            ))}
          </div>
          <Link className="btn btn-sm" to="/compare">Compare side by side</Link>
        </div>
      </div>

      <div className="grid grid-3">
        {sorted.map((path) => {
          const progress = progressFor(path.id);
          return (
            <Link key={path.id} to={`/paths/${path.id}`} className="card path-card">
              <div className="row-between">
                <h3>{path.name}</h3>
                <DifficultyTag level={path.difficulty} />
              </div>
              <p className="tagline">{path.tagline}</p>

              <dl style={{ margin: 0, fontSize: '0.85rem' }}>
                <div className="row-between">
                  <dt className="muted">First role in</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{path.avgTimeline}</dd>
                </div>
                <div className="row-between">
                  <dt className="muted">Entry pay</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{salary(path.salaryRange)}</dd>
                </div>
                <div className="row-between">
                  <dt className="muted">Required cost</dt>
                  <dd style={{ margin: 0, fontWeight: 600 }}>{money(path.totals.requiredCost)}</dd>
                </div>
              </dl>

              {progress?.touched && (
                <div className="stack-sm">
                  <Bar percent={progress.percent} />
                  <div className="faint">{progress.percent}% — {progress.completedSteps}/{progress.requiredSteps} steps</div>
                </div>
              )}

              <div className="path-meta">
                <span className="tag">{path.totals.requiredSteps} steps</span>
                <span className="tag">~{path.totals.requiredHours}h</span>
                <span className="tag tag-nopc">{path.totals.noPcSteps} no-PC</span>
                {path.remoteFriendly.level === 'high' && <span className="tag tag-accent">Remote-friendly</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
