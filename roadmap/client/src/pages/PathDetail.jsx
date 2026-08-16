import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { StepCard } from '../components/StepCard.jsx';
import { Bar, DifficultyTag, Empty, ProgressRing } from '../components/common.jsx';
import { dollars, hours, matchesFilters, money, salary } from '../lib/format.js';

const TABS = [
  ['roadmap', 'Roadmap'],
  ['interview', 'Interview prep'],
  ['resume', 'Resume bullets'],
  ['about', 'Reality check'],
];

export function PathDetail() {
  const { pathId } = useParams();
  const { pathsById, summary, progressByStep, user, updateUser } = useApp();
  const [tab, setTab] = useState('roadmap');
  const [filters, setFilters] = useState({ noPc: false, free: false, quick: false, hideOptional: false });
  const [hideMode, setHideMode] = useState(false);
  const [copied, setCopied] = useState(false);

  const path = pathsById.get(pathId);
  const progress = summary.perPath?.find((p) => p.pathId === pathId);

  const filtered = useMemo(() => {
    if (!path) return [];
    return path.steps.map((step) => ({ step, matches: matchesFilters(step, filters) }));
  }, [path, filters]);

  const resumeBullets = useMemo(() => {
    if (!path) return [];
    return path.steps
      .filter((step) => progressByStep.get(step.id)?.status === 'done' && step.resumeBullet)
      .map((step) => step.resumeBullet);
  }, [path, progressByStep]);

  if (!path) {
    return (
      <Empty title="Path not found">
        <Link className="btn" to="/paths">Back to all paths</Link>
      </Empty>
    );
  }

  const anyFilter = Object.values(filters).some(Boolean);
  const visible = hideMode ? filtered.filter((f) => f.matches) : filtered;
  const isPrimary = user?.primaryPath === path.id;

  return (
    <>
      <p className="faint no-print" style={{ marginBottom: '0.5rem' }}>
        <Link to="/paths">← All paths</Link>
      </p>

      <div className="card card-pad" style={{ marginBottom: '1.25rem' }}>
        <div className="row-between">
          <div style={{ flex: 1, minWidth: '240px' }}>
            <div className="row">
              <h1 style={{ margin: 0 }}>{path.name}</h1>
              <DifficultyTag level={path.difficulty} />
            </div>
            <p className="muted" style={{ margin: '0.4rem 0 0', maxWidth: '65ch' }}>{path.description}</p>
          </div>
          <ProgressRing percent={progress?.percent || 0} size={72} />
        </div>

        <div className="grid grid-auto" style={{ marginTop: '1.1rem' }}>
          <div className="stat">
            <div className="stat-label">Time to first role</div>
            <div style={{ fontWeight: 640 }}>{path.avgTimeline}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Entry salary</div>
            <div style={{ fontWeight: 640 }}>{salary(path.salaryRange)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Required cost</div>
            <div style={{ fontWeight: 640 }}>{money(path.totals.requiredCost)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Study hours</div>
            <div style={{ fontWeight: 640 }}>~{path.totals.requiredHours}h</div>
          </div>
        </div>

        <div className="row no-print" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className={`btn btn-sm${isPrimary ? '' : ' btn-primary'}`}
            onClick={() => updateUser({ primaryPath: isPrimary ? null : path.id })}
          >
            {isPrimary ? '★ Your main path' : 'Make this my main path'}
          </button>
          <Link className="btn btn-sm" to="/schedule">Weekly plan</Link>
          <Link className="btn btn-sm" to={`/print/${path.id}`}>Print / export</Link>
        </div>
      </div>

      <div className="filters no-print">
        <div className="row-between">
          <div className="filter-chips">
            <button type="button" className="chip" aria-pressed={filters.noPc} onClick={() => setFilters((f) => ({ ...f, noPc: !f.noPc }))}>
              📱 No PC needed yet
            </button>
            <button type="button" className="chip" aria-pressed={filters.free} onClick={() => setFilters((f) => ({ ...f, free: !f.free }))}>
              Free only
            </button>
            <button type="button" className="chip" aria-pressed={filters.quick} onClick={() => setFilters((f) => ({ ...f, quick: !f.quick }))}>
              Under 3 months
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={filters.hideOptional}
              onClick={() => setFilters((f) => ({ ...f, hideOptional: !f.hideOptional }))}
            >
              Required only
            </button>
          </div>
          {anyFilter && (
            <div className="row">
              <button type="button" className="chip" aria-pressed={hideMode} onClick={() => setHideMode((v) => !v)}>
                {hideMode ? 'Hiding non-matching' : 'Dimming non-matching'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFilters({ noPc: false, free: false, quick: false, hideOptional: false })}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="filter-chips no-print" style={{ marginBottom: '1rem' }} role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" className="chip" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'roadmap' && (
        <>
          {progress?.touched && (
            <div style={{ marginBottom: '1rem' }}>
              <Bar percent={progress.percent} />
              <p className="faint" style={{ marginTop: '0.35rem' }}>
                {progress.completedSteps} of {progress.requiredSteps} required steps · {hours(progress.hoursLogged)} logged ·{' '}
                {dollars(progress.costSpent)} spent
              </p>
            </div>
          )}
          <ol className="timeline">
            {visible.map(({ step, matches }) => (
              <StepCard key={step.id} step={step} pathId={path.id} index={path.steps.indexOf(step)} dimmed={anyFilter && !matches} />
            ))}
          </ol>
          {visible.length === 0 && <Empty title="No steps match those filters">Loosen a filter to see the rest of the path.</Empty>}
        </>
      )}

      {tab === 'interview' && (
        <div className="stack">
          <div className="callout">
            <strong>Jobs to search for</strong>
            {path.nextRoles.join(' · ')}
          </div>
          {path.interviewPrep.map((item) => (
            <div className="card card-pad" key={item.question}>
              <span className="tag tag-accent">{item.topic}</span>
              <h3 style={{ margin: '0.5rem 0 0.4rem' }}>{item.question}</h3>
              <p className="muted small" style={{ margin: 0 }}>{item.why}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'resume' && (
        <div className="card card-pad">
          <h2>Resume bullets from your completed steps</h2>
          <p className="muted small">
            These are generated from steps you have marked done — nothing here claims anything you have not actually
            finished. Edit the wording to match the job you are applying for.
          </p>
          {resumeBullets.length === 0 ? (
            <Empty title="Nothing to export yet">Complete a step that produces evidence — a cert, a project, real experience — and it shows up here.</Empty>
          ) : (
            <>
              <ul>
                {resumeBullets.map((bullet) => (
                  <li key={bullet} style={{ marginBottom: '0.4rem' }}>{bullet}</li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-sm no-print"
                onClick={async () => {
                  await navigator.clipboard?.writeText(resumeBullets.map((b) => `• ${b}`).join('\n'));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy all'}
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'about' && (
        <div className="stack">
          <div className="card card-pad">
            <h2>The honest version</h2>
            <p>{path.realityCheck}</p>
            <h3>Why this might fit you</h3>
            <p className="muted">{path.whyItFits}</p>
            <h3>Remote work</h3>
            <p className="muted">{path.remoteFriendly.note}</p>
            <h3>Pay</h3>
            <p className="muted">{path.salaryRange.note}</p>
          </div>

          <div className="card card-pad">
            <h2>Someone who did it</h2>
            <blockquote style={{ margin: '0 0 0.75rem', paddingLeft: '1rem', borderLeft: '3px solid var(--accent)', fontStyle: 'italic' }}>
              {path.motivation.quote}
            </blockquote>
            <p className="muted small">{path.motivation.story}</p>
            <p className="faint">{path.motivation.source}</p>
          </div>

          <div className="card card-pad">
            <h2>Where this leads next</h2>
            <div className="row">
              {path.nextPaths.map((id) => (
                <Link key={id} className="btn btn-sm" to={`/paths/${id}`}>
                  {pathsById.get(id)?.name || id}
                </Link>
              ))}
            </div>
            <p className="faint" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              See the whole network on the <Link to="/map">pivot map</Link> — switching paths rarely means starting over.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
