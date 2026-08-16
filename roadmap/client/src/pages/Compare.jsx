import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, salary } from '../lib/format.js';

const MAX = 3;

export function Compare() {
  const { paths, pathsById } = useApp();
  const [selected, setSelected] = useState([]);
  const [saved, setSaved] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/comparisons').then((data) => setSaved(data.comparisons)).catch(() => {});
  }, []);

  const toggle = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX ? current : [...current, id],
    );

  const chosen = selected.map((id) => pathsById.get(id)).filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      const created = await api.post('/comparisons', { pathIds: selected });
      setSaved((current) => [{ ...created, createdAt: new Date().toISOString() }, ...current]);
    } catch {
      // Offline — comparisons are a convenience, not worth an error state.
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    await api.del(`/comparisons/${id}`).catch(() => {});
    setSaved((current) => current.filter((c) => c.id !== id));
  };

  const rows = [
    ['Time to first role', (p) => p.avgTimeline],
    ['Entry salary', (p) => salary(p.salaryRange)],
    ['Difficulty', (p) => ({ gentle: 'Gentle start', moderate: 'Moderate', hard: 'Demanding' }[p.difficulty])],
    ['Required cost', (p) => money(p.totals.requiredCost)],
    ['Cost incl. optional', (p) => money(p.totals.totalCost)],
    ['Study hours', (p) => `~${p.totals.requiredHours}h`],
    ['Required steps', (p) => p.totals.requiredSteps],
    ['Steps with no PC needed', (p) => `${p.totals.noPcSteps} of ${p.totals.steps}`],
    ['Free steps', (p) => `${p.totals.freeSteps} of ${p.totals.steps}`],
    ['Certifications', (p) => p.totals.certSteps],
    ['Hands-on projects', (p) => p.totals.projectSteps],
    ['Remote-friendly', (p) => p.remoteFriendly.note],
    ['First job titles', (p) => p.nextRoles.slice(0, 3).join(', ')],
    ['The honest catch', (p) => p.realityCheck],
  ];

  return (
    <>
      <div className="page-head">
        <h1>Compare paths</h1>
        <p className="lede">Pick two or three. The bottom rows are the ones worth reading twice — cost and the honest catch.</p>
      </div>

      <div className="filters no-print">
        <div className="filter-chips">
          {paths.map((path) => (
            <button
              key={path.id}
              type="button"
              className="chip"
              aria-pressed={selected.includes(path.id)}
              disabled={!selected.includes(path.id) && selected.length >= MAX}
              onClick={() => toggle(path.id)}
            >
              {path.name}
            </button>
          ))}
        </div>
        {selected.length >= 2 && (
          <div className="row" style={{ marginTop: '0.6rem' }}>
            <button type="button" className="btn btn-sm" onClick={save} disabled={saving}>
              Save this comparison
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        )}
      </div>

      {chosen.length < 2 ? (
        <div className="card card-pad center muted">Pick at least two paths above.</div>
      ) : (
        <div className="card">
          <div className="table-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">&nbsp;</th>
                  {chosen.map((path) => (
                    <th key={path.id} scope="col" style={{ minWidth: '200px' }}>
                      <Link to={`/paths/${path.id}`}>{path.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, get]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {chosen.map((path) => (
                      <td key={path.id}>{get(path)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <>
          <h2 style={{ marginTop: '1.75rem' }}>Saved comparisons</h2>
          <div className="stack-sm">
            {saved.map((comparison) => (
              <div className="card card-pad row-between" key={comparison.id}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(comparison.pathIds)}>
                  {comparison.label}
                </button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(comparison.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
