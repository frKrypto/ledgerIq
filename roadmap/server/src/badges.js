import { content, getPath } from './content.js';
import { nowIso } from './db.js';

/**
 * Badge rules are data, not code paths — the catalogue lives in data/badges.json
 * so adding one never means touching this file.
 */
function isEarned(rule, summary, progressRows) {
  switch (rule.type) {
    case 'stepsCompleted':
      return summary.totalCompleted >= rule.count;
    case 'stepTypeCompleted':
      return (summary.completedByType[rule.stepType] || 0) >= rule.count;
    case 'pathPercent':
      return summary.perPath.some((p) => p.percent >= rule.percent);
    case 'hoursLogged':
      return summary.totalHours >= rule.hours;
    case 'notesWritten':
      return summary.notesWritten >= rule.count;
    case 'pathsTouched':
      return summary.pathsTouched >= rule.count;
    case 'noPcStepsCompleted':
      return summary.noPcCompleted >= rule.count;
    case 'freeStepsCompleted':
      return summary.freeCompleted >= rule.count;
    case 'allStepsOfTypeInPath': {
      const doneIds = new Set(progressRows.filter((r) => r.status === 'done').map((r) => r.stepId));
      return content.paths.some((path) => {
        const steps = path.steps.filter((s) => s.type === rule.stepType && !s.optional);
        return steps.length > 0 && steps.every((s) => doneIds.has(s.id));
      });
    }
    default:
      return false;
  }
}

/**
 * Evaluates every badge and persists newly earned ones.
 * Returns the badges earned during *this* call so the UI can celebrate them.
 */
export function evaluateBadges(db, userId, summary, progressRows) {
  const already = new Set(
    db.prepare('SELECT badge_id FROM earned_badges WHERE user_id = ?').all(userId).map((r) => r.badge_id),
  );
  const newlyEarned = [];
  const insert = db.prepare('INSERT OR IGNORE INTO earned_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)');

  for (const badge of content.badges) {
    if (already.has(badge.id)) continue;
    if (!isEarned(badge.rule, summary, progressRows)) continue;
    insert.run(userId, badge.id, nowIso());
    newlyEarned.push(badge);
  }
  return newlyEarned;
}

export function listBadges(db, userId) {
  const earned = new Map(
    db
      .prepare('SELECT badge_id, earned_at FROM earned_badges WHERE user_id = ?')
      .all(userId)
      .map((r) => [r.badge_id, r.earned_at]),
  );
  return content.badges.map((badge) => ({
    ...badge,
    earned: earned.has(badge.id),
    earnedAt: earned.get(badge.id) || null,
  }));
}

/**
 * Milestone detection for the celebration animation: which path sections just
 * crossed a threshold. Compared against the summary taken before the change.
 */
export function detectMilestones(before, after) {
  const thresholds = [25, 50, 75, 100];
  const milestones = [];
  for (const nowPath of after.perPath) {
    const wasPath = before.perPath.find((p) => p.pathId === nowPath.pathId);
    const was = wasPath ? wasPath.percent : 0;
    for (const t of thresholds) {
      if (was < t && nowPath.percent >= t) {
        milestones.push({
          pathId: nowPath.pathId,
          pathName: getPath(nowPath.pathId)?.name || nowPath.pathId,
          percent: t,
        });
      }
    }
  }
  return milestones;
}
