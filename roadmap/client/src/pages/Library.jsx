import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { StepTags } from '../components/common.jsx';
import { hours } from '../lib/format.js';

/**
 * The "no PC yet" view. This is the page that answers the actual first
 * question — what can I start today, with only a phone and a library card?
 */
export function Library() {
  const { paths, progressByStep, updateStep } = useApp();
  const [pathFilter, setPathFilter] = useState('all');
  const [freeOnly, setFreeOnly] = useState(true);

  const steps = useMemo(() => {
    const out = [];
    for (const path of paths) {
      if (pathFilter !== 'all' && path.id !== pathFilter) continue;
      for (const step of path.steps) {
        if (!step.noPcRequired) continue;
        if (freeOnly && step.costEstimate > 0) continue;
        out.push({ step, path });
      }
    }
    return out;
  }, [paths, pathFilter, freeOnly]);

  const totalHours = steps.reduce((t, { step }) => t + (step.estimatedHours || 0), 0);

  return (
    <>
      <div className="page-head">
        <h1>Things you can start without a computer</h1>
        <p className="lede">
          Every step below can be done on a phone or a public library computer. That is {steps.length} steps and about{' '}
          {hours(totalHours)} of real progress before you need to own a machine — including passing certification exams,
          which are taken at a testing center, not at home.
        </p>
      </div>

      <div className="callout" style={{ marginBottom: '1.25rem' }}>
        <strong>What a public library actually gives you</strong>
        Free computer time (usually 1–2 hour sessions), free Wi-Fi, printing for job applications, and — in many US
        systems — a free LinkedIn Learning, Gale, or O'Reilly subscription that comes with your card. Some branches also
        host proctored testing. Ask at the desk; this is not advertised well.
      </div>

      <div className="filters no-print">
        <div className="row-between">
          <div>
            <label htmlFor="lib-path" style={{ display: 'inline', marginRight: '0.5rem' }}>Path</label>
            <select id="lib-path" value={pathFilter} onChange={(e) => setPathFilter(e.target.value)} style={{ width: 'auto', display: 'inline-block' }}>
              <option value="all">All paths</option>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <button type="button" className="chip" aria-pressed={freeOnly} onClick={() => setFreeOnly((v) => !v)}>
            Free only
          </button>
        </div>
      </div>

      <div className="stack-sm">
        {steps.map(({ step, path }) => {
          const status = progressByStep.get(step.id)?.status || 'not_started';
          return (
            <div className="card card-pad" key={step.id}>
              <div className="row-between">
                <div style={{ flex: 1, minWidth: '220px' }}>
                  <Link className="faint" to={`/paths/${path.id}`}>{path.name}</Link>
                  <h3 style={{ margin: '0.15rem 0 0.4rem' }}>{step.title}</h3>
                  <StepTags step={step} />
                </div>
                <button
                  type="button"
                  className={`btn btn-sm${status === 'done' ? '' : ' btn-primary'}`}
                  onClick={() => updateStep(step.id, path.id, { status: status === 'done' ? 'not_started' : 'done' })}
                >
                  {status === 'done' ? '✓ Done' : 'Mark done'}
                </button>
              </div>
              <p className="small muted" style={{ margin: '0.6rem 0 0' }}>{step.description}</p>
            </div>
          );
        })}
      </div>

      <div className="card card-pad" style={{ marginTop: '1.25rem' }}>
        <h2>Getting a computer cheaply</h2>
        <ul className="small">
          <li>
            <a href="https://www.pcsforpeople.org/" target="_blank" rel="noreferrer noopener">PCs for People</a> — a
            nonprofit selling refurbished computers to income-eligible households, frequently under $100.
          </li>
          <li>
            <a href="https://www.dell.com/en-us/dfh/scomm/" target="_blank" rel="noreferrer noopener">Dell Refurbished</a>{' '}
            and local marketplace listings — off-lease business laptops (ThinkPad, Latitude, EliteBook) run $100–250 and
            handle everything on these paths.
          </li>
          <li>
            Local community colleges, libraries, and workforce centers often lend laptops to enrolled or registered
            residents. Free is worth an awkward phone call.
          </li>
        </ul>
      </div>
    </>
  );
}
