import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Empty } from '../components/common.jsx';
import { buildSchedule, shortDate, STEP_TYPE_LABEL } from '../lib/format.js';

export function Schedule() {
  const { paths, pathsById, user, updateUser, progressByStep, summary } = useApp();
  const [pathId, setPathId] = useState(user?.primaryPath || summary.perPath?.find((p) => p.touched)?.pathId || paths[0]?.id);
  const [weeklyHours, setWeeklyHours] = useState(user?.weeklyHours || 8);

  const path = pathsById.get(pathId);
  const weeks = useMemo(
    () => (path ? buildSchedule(path, weeklyHours, progressByStep) : []),
    [path, weeklyHours, progressByStep],
  );

  if (!path) return <Empty title="Pick a path first"><Link className="btn" to="/paths">Browse paths</Link></Empty>;

  const finishDate = weeks.at(-1)?.to;
  const totalHours = weeks.reduce((t, w) => t + w.hours, 0);

  return (
    <>
      <div className="page-head">
        <h1>Weekly plan</h1>
        <p className="lede">
          Your remaining steps paced against the hours you actually have. Completed steps drop out, so the dates move
          with you — and if you fall behind, the honest fix is lowering the hours, not abandoning the plan.
        </p>
      </div>

      <div className="card card-pad no-print" style={{ marginBottom: '1.25rem' }}>
        <div className="grid grid-2">
          <div>
            <label htmlFor="path">Path</label>
            <select id="path" value={pathId} onChange={(e) => setPathId(e.target.value)}>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="hours">Hours available per week: {weeklyHours}</label>
            <input
              id="hours"
              type="range"
              min="1"
              max="40"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(Number(e.target.value))}
            />
            {weeklyHours !== user?.weeklyHours && (
              <button type="button" className="btn btn-sm" style={{ marginTop: '0.4rem' }} onClick={() => updateUser({ weeklyHours })}>
                Save {weeklyHours} h/week as my default
              </button>
            )}
          </div>
        </div>
      </div>

      {weeks.length === 0 ? (
        <Empty title="Every required step is done">
          Nothing left to schedule on this path. Time to be applying — see the interview prep tab on{' '}
          <Link to={`/paths/${path.id}`}>{path.name}</Link>.
        </Empty>
      ) : (
        <>
          <div className="callout" style={{ marginBottom: '1.25rem' }}>
            <strong>
              {weeks.length} week{weeks.length === 1 ? '' : 's'} left at {weeklyHours}h/week — finishing around{' '}
              {shortDate(finishDate)}
            </strong>
            About {Math.round(totalHours)} hours of work remaining. That is the study time only; job searching is on top
            of it.
          </div>

          <div className="stack">
            {weeks.map((week) => (
              <div className={`card card-pad week-card${week.weekNumber === 1 ? ' current' : ''}`} key={week.weekNumber}>
                <div className="row-between">
                  <h3 style={{ margin: 0 }}>Week {week.weekNumber}</h3>
                  <span className="faint">
                    {shortDate(week.from)} – {shortDate(week.to)} · {Math.round(week.hours * 10) / 10}h
                  </span>
                </div>
                <ul style={{ margin: '0.6rem 0 0', paddingLeft: '1.1rem' }}>
                  {week.items.map((item) => (
                    <li key={item.stepId} className="small">
                      <span className={`tag type-${item.type}`} style={{ marginRight: '0.4rem' }}>
                        {STEP_TYPE_LABEL[item.type]}
                      </span>
                      {item.title} <span className="faint">— {item.hours}h this week</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
