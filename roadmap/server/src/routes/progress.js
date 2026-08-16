import { Router } from 'express';
import { requireUser } from '../auth.js';
import { listProgress, saveProgress, summarize } from '../progress.js';
import { detectMilestones, evaluateBadges, listBadges } from '../badges.js';
import { daysSince } from '../util.js';

export function progressRoutes(db) {
  const router = Router();
  router.use(requireUser);

  router.get('/', (req, res) => {
    const rows = listProgress(db, req.user.id);
    res.json({ progress: rows, summary: summarize(rows) });
  });

  router.put('/:stepId', (req, res) => {
    const before = summarize(listProgress(db, req.user.id));
    const result = saveProgress(db, req.user.id, req.params.stepId, req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });

    const rows = listProgress(db, req.user.id);
    const after = summarize(rows);
    const newBadges = evaluateBadges(db, req.user.id, after, rows);

    res.json({
      progress: rows.find((r) => r.stepId === req.params.stepId),
      summary: after,
      newBadges,
      milestones: detectMilestones(before, after),
    });
  });

  /**
   * Offline sync. The client queues writes while disconnected and replays them
   * here in order. Conflicts resolve last-write-wins, which is right for a
   * single-user-per-account tool where the only conflict is one person on two
   * devices.
   */
  router.post('/bulk', (req, res) => {
    const updates = Array.isArray(req.body?.updates) ? req.body.updates.slice(0, 500) : [];
    const before = summarize(listProgress(db, req.user.id));
    const errors = [];

    for (const update of updates) {
      const result = saveProgress(db, req.user.id, update.stepId, update);
      if (result.error) errors.push({ stepId: update.stepId, error: result.error });
    }

    const rows = listProgress(db, req.user.id);
    const after = summarize(rows);
    const newBadges = evaluateBadges(db, req.user.id, after, rows);

    res.json({
      applied: updates.length - errors.length,
      errors,
      progress: rows,
      summary: after,
      newBadges,
      milestones: detectMilestones(before, after),
    });
  });

  router.get('/badges', (req, res) => {
    res.json({ badges: listBadges(db, req.user.id) });
  });

  /** Everything the dashboard needs in one request. */
  router.get('/dashboard', (req, res) => {
    const rows = listProgress(db, req.user.id);
    const summary = summarize(rows);
    const idle = daysSince(req.user.last_progress_at);
    res.json({
      summary,
      badges: listBadges(db, req.user.id),
      nudge:
        req.user.nudge_days > 0 && idle !== null && idle >= req.user.nudge_days
          ? { daysIdle: idle, threshold: req.user.nudge_days }
          : null,
    });
  });

  return router;
}
