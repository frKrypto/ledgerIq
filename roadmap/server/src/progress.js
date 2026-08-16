import { content, getStep } from './content.js';
import { nowIso } from './db.js';

export const STATUSES = ['not_started', 'in_progress', 'done'];

export function listProgress(db, userId) {
  return db
    .prepare('SELECT * FROM progress WHERE user_id = ?')
    .all(userId)
    .map((row) => ({
      stepId: row.step_id,
      pathId: row.path_id,
      status: row.status,
      notes: row.notes,
      hoursLogged: row.hours_logged,
      costSpent: row.cost_spent,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    }));
}

/**
 * Upsert a single step's progress. Timestamps are derived rather than trusted
 * from the client so that an offline replay can't rewrite history.
 */
export function saveProgress(db, userId, stepId, patch) {
  const found = getStep(stepId);
  if (!found) return { error: `Unknown step: ${stepId}` };

  const existing = db.prepare('SELECT * FROM progress WHERE user_id = ? AND step_id = ?').get(userId, stepId);
  const now = nowIso();

  const status = patch.status ?? existing?.status ?? 'not_started';
  if (!STATUSES.includes(status)) return { error: `Unknown status: ${status}` };

  const notes = patch.notes ?? existing?.notes ?? '';
  const hours = clampNumber(patch.hoursLogged ?? existing?.hours_logged ?? 0, 0, 10_000);

  // Cost is auto-derived from the step's own estimate the first time a paid
  // step is completed, so the budget view is useful without any data entry.
  // An explicit value from the user always wins and is never overwritten.
  const priorCost = existing?.cost_spent ?? 0;
  let resolvedCost = priorCost;
  if (patch.costSpent !== undefined) {
    resolvedCost = clampNumber(patch.costSpent, 0, 1_000_000);
  } else if (status === 'done' && priorCost === 0) {
    resolvedCost = found.step.costEstimate || 0;
  }

  const startedAt = existing?.started_at ?? (status !== 'not_started' ? now : null);
  const completedAt = status === 'done' ? (existing?.completed_at ?? now) : null;

  db.prepare(
    `INSERT INTO progress (user_id, step_id, path_id, status, notes, hours_logged, cost_spent, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, step_id) DO UPDATE SET
       status = excluded.status,
       notes = excluded.notes,
       hours_logged = excluded.hours_logged,
       cost_spent = excluded.cost_spent,
       started_at = excluded.started_at,
       completed_at = excluded.completed_at,
       updated_at = excluded.updated_at`,
  ).run(userId, stepId, found.pathId, status, notes, hours, resolvedCost, startedAt, completedAt, now);

  db.prepare('UPDATE users SET last_progress_at = ? WHERE id = ?').run(now, userId);

  return { ok: true };
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Aggregate stats used by badges, the dashboard, and the shared view. */
export function summarize(progressRows) {
  const byStep = new Map(progressRows.map((row) => [row.stepId, row]));
  const done = progressRows.filter((r) => r.status === 'done');
  const doneSteps = done.map((r) => getStep(r.stepId)?.step).filter(Boolean);

  const perPath = content.paths.map((path) => {
    const required = path.steps.filter((s) => !s.optional);
    const completedRequired = required.filter((s) => byStep.get(s.id)?.status === 'done');
    const inProgress = path.steps.filter((s) => byStep.get(s.id)?.status === 'in_progress');
    const rows = path.steps.map((s) => byStep.get(s.id)).filter(Boolean);

    return {
      pathId: path.id,
      name: path.name,
      requiredSteps: required.length,
      completedSteps: completedRequired.length,
      inProgressSteps: inProgress.length,
      percent: required.length ? Math.round((completedRequired.length / required.length) * 100) : 0,
      hoursLogged: round1(rows.reduce((t, r) => t + r.hoursLogged, 0)),
      costSpent: round2(rows.reduce((t, r) => t + r.costSpent, 0)),
      touched: rows.some((r) => r.status !== 'not_started'),
      lastActivity: rows.map((r) => r.updatedAt).sort().at(-1) || null,
    };
  });

  return {
    totalCompleted: done.length,
    totalHours: round1(progressRows.reduce((t, r) => t + r.hoursLogged, 0)),
    totalSpent: round2(progressRows.reduce((t, r) => t + r.costSpent, 0)),
    notesWritten: progressRows.filter((r) => r.notes.trim().length > 0).length,
    pathsTouched: perPath.filter((p) => p.touched).length,
    completedByType: countBy(doneSteps, (s) => s.type),
    noPcCompleted: doneSteps.filter((s) => s.noPcRequired).length,
    freeCompleted: doneSteps.filter((s) => !s.costEstimate).length,
    perPath,
    lastActivity: progressRows.map((r) => r.updatedAt).sort().at(-1) || null,
  };
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
