import { useState } from 'react';
import { useApp } from '../lib/store.jsx';
import { StepTags } from './common.jsx';
import { money, shortDate } from '../lib/format.js';

const STATUS_LABEL = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };

export function StepCard({ step, pathId, index, dimmed, defaultOpen = false }) {
  const { progressByStep, updateStep } = useApp();
  const record = progressByStep.get(step.id);
  const status = record?.status || 'not_started';
  const [open, setOpen] = useState(defaultOpen);
  const [notes, setNotes] = useState(record?.notes || '');
  const [notesDirty, setNotesDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const setStatus = async (next) => {
    setSaving(true);
    try {
      await updateStep(step.id, pathId, { status: next === status ? 'not_started' : next });
    } finally {
      setSaving(false);
    }
  };

  const cycleFromNode = () => {
    const next = status === 'done' ? 'not_started' : status === 'in_progress' ? 'done' : 'in_progress';
    setStatus(next);
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await updateStep(step.id, pathId, { notes });
      setNotesDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const logHours = async (delta) => {
    const next = Math.max(0, (record?.hoursLogged || 0) + delta);
    await updateStep(step.id, pathId, { hoursLogged: next, status: status === 'not_started' ? 'in_progress' : status });
  };

  return (
    <li>
      <button
        type="button"
        className={`node ${status}`}
        onClick={cycleFromNode}
        disabled={saving}
        aria-label={`${step.title} — ${STATUS_LABEL[status]}. Click to change status.`}
        title={STATUS_LABEL[status]}
      >
        {status === 'done' ? '✓' : index + 1}
      </button>

      <div className={`step${status === 'done' ? ' is-done' : ''}${dimmed ? ' filtered-out' : ''}`}>
        <button type="button" className="step-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="step-title">{step.title}</p>
            <StepTags step={step} />
          </div>
          <span className="step-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div className="step-body">
            <p>{step.description}</p>

            {/* Paid steps get a loud callout; free ones get a quiet line, so the
                money warnings stay visually rare enough to actually register. */}
            {step.costNote &&
              (step.costEstimate > 0 ? (
                <div className="callout callout-warn">
                  <strong>Costs {money(step.costEstimate)}</strong>
                  {step.costNote}
                </div>
              ) : (
                <p className="small muted">
                  <span className="tag tag-free">Free</span>{' '}
                  {/* The tag already says "Free" — don't say it twice. */}
                  {step.costNote.replace(/^Free[.\s—-]*/, '')}
                </p>
              ))}

            {step.outcome && (
              <>
                <h4>What you end up with</h4>
                <p className="small">{step.outcome}</p>
              </>
            )}

            <h4>Resources</h4>
            {step.resources.map((resource) => (
              <div className="resource" key={resource.name}>
                <div className="resource-main">
                  <div className="resource-name">
                    {resource.url?.startsWith('http') ? (
                      <a href={resource.url} target="_blank" rel="noreferrer noopener">
                        {resource.name}
                      </a>
                    ) : (
                      resource.name
                    )}
                  </div>
                  {resource.notes && <div className="resource-note">{resource.notes}</div>}
                  <div className="faint">Last verified {resource.lastVerified}</div>
                </div>
                <span className={`tag ${resource.cost > 0 ? 'tag-paid' : 'tag-free'}`}>
                  {resource.cost > 0 ? money(resource.cost) : 'Free'}
                </span>
              </div>
            ))}

            <div className="tracker">
              <div className="stack-sm">
                <label id={`status-${step.id}`}>Progress</label>
                <div className="status-group" role="group" aria-labelledby={`status-${step.id}`}>
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="status-btn"
                      aria-pressed={status === value}
                      onClick={() => updateStep(step.id, pathId, { status: value })}
                      disabled={saving}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="tracker-row" style={{ marginTop: '0.85rem' }}>
                <div>
                  <label htmlFor={`hours-${step.id}`}>Hours logged</label>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => logHours(-1)} aria-label="Subtract an hour">
                      −1
                    </button>
                    <input
                      id={`hours-${step.id}`}
                      type="number"
                      min="0"
                      step="0.5"
                      value={record?.hoursLogged ?? 0}
                      onChange={(e) => updateStep(step.id, pathId, { hoursLogged: Number(e.target.value) })}
                      style={{ textAlign: 'center' }}
                    />
                    <button type="button" className="btn btn-sm" onClick={() => logHours(1)} aria-label="Add an hour">
                      +1
                    </button>
                  </div>
                  {step.estimatedHours > 0 && <div className="faint">Estimated: {step.estimatedHours}h</div>}
                </div>

                <div>
                  <label htmlFor={`cost-${step.id}`}>Actually spent ($)</label>
                  <input
                    id={`cost-${step.id}`}
                    type="number"
                    min="0"
                    step="1"
                    value={record?.costSpent ?? 0}
                    onChange={(e) => updateStep(step.id, pathId, { costSpent: Number(e.target.value) })}
                  />
                  <div className="faint">
                    {step.costEstimate > 0 ? `Auto-filled with ${money(step.costEstimate)} when done` : 'This step should cost nothing'}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.85rem' }}>
                <label htmlFor={`notes-${step.id}`}>Your notes</label>
                <textarea
                  id={`notes-${step.id}`}
                  value={notes}
                  placeholder="What you tried, what confused you, where you left off…"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setNotesDirty(true);
                  }}
                  onBlur={() => notesDirty && saveNotes()}
                />
                {notesDirty && (
                  <button type="button" className="btn btn-sm" onClick={saveNotes} disabled={saving}>
                    Save notes
                  </button>
                )}
              </div>

              {record?.completedAt && <div className="faint" style={{ marginTop: '0.5rem' }}>Completed {shortDate(record.completedAt)}</div>}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
