import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { money, salary } from '../lib/format.js';

export function Quiz() {
  const { quiz, pathsById, updateUser, user } = useApp();
  const [answers, setAnswers] = useState({});
  const [weeklyHours, setWeeklyHours] = useState(user?.weeklyHours || 8);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!quiz) return <div className="empty">Loading…</div>;

  const setSingle = (questionId, optionId) => setAnswers((a) => ({ ...a, [questionId]: optionId }));
  const toggleMulti = (questionId, optionId) =>
    setAnswers((a) => {
      const current = Array.isArray(a[questionId]) ? a[questionId] : [];
      return {
        ...a,
        [questionId]: current.includes(optionId) ? current.filter((x) => x !== optionId) : [...current, optionId],
      };
    });

  const answered = quiz.questions.filter((q) => {
    const value = answers[q.id];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  }).length;

  const submit = async () => {
    setBusy(true);
    try {
      const { ranking } = await api.post('/quiz', { answers });
      setResult(ranking);
      await updateUser({ weeklyHours, onboarded: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const top = result.ranked.slice(0, 3);
    return (
      <>
        <div className="page-head">
          <h1>Your best-fit starting points</h1>
          <p className="lede">
            This is a suggestion based on eight questions, not a verdict. If the second or third one appeals to you more,
            take that one — the paths overlap far more than they look like they do.
          </p>
        </div>

        {result.notes.map((note) => (
          <div className="banner" key={note}>
            <span aria-hidden="true">ℹ️</span>
            <div>{note}</div>
          </div>
        ))}

        <div className="stack">
          {top.map((entry, index) => {
            const path = pathsById.get(entry.pathId);
            if (!path) return null;
            return (
              <div className="card card-pad" key={entry.pathId}>
                <div className="row-between">
                  <div>
                    <span className="tag tag-accent">{index === 0 ? 'Best fit' : `Option ${index + 1}`}</span>
                    <h2 style={{ margin: '0.4rem 0 0.2rem' }}>{path.name}</h2>
                    <p className="muted" style={{ margin: 0 }}>{path.tagline}</p>
                  </div>
                </div>
                <div className="row" style={{ marginTop: '0.75rem' }}>
                  <span className="tag">{path.avgTimeline}</span>
                  <span className="tag">{salary(path.salaryRange)}</span>
                  <span className="tag">{money(path.totals.requiredCost)} required cost</span>
                  <span className="tag tag-nopc">{path.totals.noPcSteps} steps need no PC</span>
                </div>
                <p className="small" style={{ marginTop: '0.75rem' }}>{path.whyItFits}</p>
                <div className="row">
                  <Link className="btn btn-primary btn-sm" to={`/paths/${path.id}`}>Open this roadmap</Link>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => updateUser({ primaryPath: path.id })}
                  >
                    Make it my main path
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card card-pad" style={{ marginTop: '1.25rem' }}>
          <h3>Full ranking</h3>
          <ol className="small muted">
            {result.ranked.map((entry) => (
              <li key={entry.pathId}>
                <Link to={`/paths/${entry.pathId}`}>{entry.name}</Link> <span className="faint">({entry.score})</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-sm" onClick={() => { setResult(null); setAnswers({}); }}>
            Retake the quiz
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>Find my path</h1>
        <p className="lede">{quiz.intro}</p>
      </div>

      <div className="stack">
        {quiz.questions.map((question, index) => (
          <fieldset className="card card-pad" key={question.id} style={{ border: '1px solid var(--border)' }}>
            <legend className="stat-label" style={{ padding: '0 0.4rem' }}>Question {index + 1} of {quiz.questions.length}</legend>
            <h3 style={{ marginTop: '0.25rem' }}>{question.prompt}</h3>
            {question.type === 'multi' && <p className="faint" style={{ marginTop: '-0.35rem' }}>Pick all that apply.</p>}
            <div className="stack-sm">
              {question.options.map((option) => {
                const value = answers[question.id];
                const checked = question.type === 'multi' ? (value || []).includes(option.id) : value === option.id;
                return (
                  <label
                    key={option.id}
                    style={{
                      display: 'flex',
                      gap: '0.6rem',
                      alignItems: 'flex-start',
                      padding: '0.6rem 0.7rem',
                      border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                      background: checked ? 'var(--accent-soft)' : 'transparent',
                      borderRadius: '9px',
                      cursor: 'pointer',
                      fontWeight: 500,
                      color: 'var(--text)',
                      fontSize: '0.92rem',
                      marginBottom: 0,
                    }}
                  >
                    <input
                      type={question.type === 'multi' ? 'checkbox' : 'radio'}
                      name={question.id}
                      checked={checked}
                      onChange={() =>
                        question.type === 'multi' ? toggleMulti(question.id, option.id) : setSingle(question.id, option.id)
                      }
                      style={{ width: 'auto', minHeight: 'auto', marginTop: '0.2rem' }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <div className="card card-pad">
          <h3>Last thing: how many hours a week can you realistically give this?</h3>
          <p className="faint">Be pessimistic. A plan built on 6 honest hours beats one built on 20 aspirational ones.</p>
          <div className="row">
            <input
              type="range"
              min="1"
              max="40"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(Number(e.target.value))}
              style={{ flex: 1, minWidth: '160px' }}
            />
            <span className="tag tag-accent">{weeklyHours} h/week</span>
          </div>
        </div>

        <button type="button" className="btn btn-primary" onClick={submit} disabled={answered < quiz.questions.length || busy}>
          {answered < quiz.questions.length ? `Answer all ${quiz.questions.length} questions (${answered} done)` : 'Show my results'}
        </button>
      </div>
    </>
  );
}
