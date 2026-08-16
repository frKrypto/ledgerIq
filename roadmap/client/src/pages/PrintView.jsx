import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { Empty } from '../components/common.jsx';
import { money, salary, shortDate, STEP_TYPE_LABEL } from '../lib/format.js';

/**
 * Clean printable roadmap. Everything is expanded, links print as visible URLs
 * (see the @media print rules), and the interactive furniture is hidden — this
 * is meant to be taken to a library and worked through on paper.
 */
export function PrintView() {
  const { pathId } = useParams();
  const { pathsById, progressByStep, user } = useApp();
  const path = pathsById.get(pathId);

  useEffect(() => {
    if (path) document.title = `${path.name} — roadmap`;
    return () => {
      document.title = 'No-Degree Tech Roadmap';
    };
  }, [path]);

  if (!path) return <Empty title="Path not found"><Link className="btn" to="/paths">Back to paths</Link></Empty>;

  return (
    <div className="main">
      <div className="row no-print" style={{ marginBottom: '1.25rem' }}>
        <Link className="btn btn-sm" to={`/paths/${path.id}`}>← Back</Link>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => window.print()}>Print or save as PDF</button>
      </div>

      <header style={{ borderBottom: '2px solid var(--border-strong)', paddingBottom: '0.85rem', marginBottom: '1.25rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>{path.name}</h1>
        <p className="muted" style={{ margin: 0 }}>{path.tagline}</p>
        <p className="small" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
          <strong>Timeline:</strong> {path.avgTimeline} · <strong>Entry pay:</strong> {salary(path.salaryRange)} ·{' '}
          <strong>Required cost:</strong> {money(path.totals.requiredCost)} · <strong>Study time:</strong> ~
          {path.totals.requiredHours}h
        </p>
        <p className="faint" style={{ margin: '0.4rem 0 0' }}>
          Printed for {user?.displayName} on {shortDate(new Date().toISOString())}. Prices and course links were last
          verified in the month shown against each resource — check before paying for anything.
        </p>
      </header>

      <section style={{ marginBottom: '1.5rem' }}>
        <h2>The honest version</h2>
        <p className="small">{path.realityCheck}</p>
      </section>

      {/* Wide enough that a two-digit step marker isn't clipped when printed. */}
      <ol style={{ paddingLeft: '2rem' }}>
        {path.steps.map((step) => {
          const record = progressByStep.get(step.id);
          return (
            <li key={step.id} style={{ marginBottom: '1.5rem', breakInside: 'avoid' }}>
              <h3 style={{ marginBottom: '0.2rem' }}>
                {record?.status === 'done' ? '☑' : '☐'} {step.title}
                {step.optional && ' (optional)'}
              </h3>
              <p className="faint" style={{ margin: '0 0 0.4rem' }}>
                {STEP_TYPE_LABEL[step.type]} · {step.estimatedTime} ·{' '}
                {step.costEstimate > 0 ? money(step.costEstimate) : 'Free'}
                {step.noPcRequired ? ' · No PC needed' : ''}
              </p>
              <p className="small" style={{ marginBottom: '0.4rem' }}>{step.description}</p>
              {step.costNote && step.costEstimate > 0 && (
                <p className="small"><strong>Cost note:</strong> {step.costNote}</p>
              )}
              <ul className="small" style={{ marginTop: '0.3rem' }}>
                {step.resources.map((resource) => (
                  <li key={resource.name}>
                    {resource.url?.startsWith('http') ? <a href={resource.url}>{resource.name}</a> : resource.name}
                    {resource.cost > 0 ? ` — ${money(resource.cost)}` : ' — free'}
                    {resource.notes ? `. ${resource.notes}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <section style={{ breakBefore: 'page' }}>
        <h2>Jobs to search for</h2>
        <p className="small">{path.nextRoles.join(' · ')}</p>

        <h2 style={{ marginTop: '1.25rem' }}>Interview questions to be ready for</h2>
        <ol className="small">
          {path.interviewPrep.map((item) => (
            <li key={item.question} style={{ marginBottom: '0.6rem' }}>
              <strong>{item.question}</strong>
              <br />
              {item.why}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
