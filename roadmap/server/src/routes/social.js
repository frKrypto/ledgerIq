import { Router } from 'express';
import { requireUser } from '../auth.js';
import { content, getStep } from '../content.js';
import { listProgress, summarize } from '../progress.js';
import { listBadges } from '../badges.js';
import { nowIso } from '../db.js';

export function socialRoutes(db) {
  const router = Router();

  /**
   * Shared accountability dashboard. Opt-in on both sides: you only appear in
   * someone else's view if you set shareProgress, and you only see others if
   * you've set it yourself.
   */
  router.get('/shared', requireUser, (req, res) => {
    if (!req.user.share_progress) {
      return res.json({ sharing: false, peers: [] });
    }

    const peers = db
      .prepare('SELECT * FROM users WHERE share_progress = 1 ORDER BY display_name')
      .all()
      .map((user) => {
        const rows = listProgress(db, user.id);
        const summary = summarize(rows);
        const badges = listBadges(db, user.id).filter((b) => b.earned);
        return {
          id: user.id,
          displayName: user.display_name,
          isYou: user.id === req.user.id,
          primaryPath: user.primary_path,
          weeklyHours: user.weekly_hours,
          lastProgressAt: user.last_progress_at,
          totals: {
            completed: summary.totalCompleted,
            hours: summary.totalHours,
            spent: summary.totalSpent,
            badges: badges.length,
          },
          paths: summary.perPath.filter((p) => p.touched),
          recentBadges: badges.slice(-3),
        };
      });

    res.json({ sharing: true, peers });
  });

  /** Saved side-by-side path comparisons. */
  router.get('/comparisons', requireUser, (req, res) => {
    const rows = db
      .prepare('SELECT * FROM saved_comparisons WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id);
    res.json({
      comparisons: rows.map((r) => ({
        id: r.id,
        label: r.label,
        pathIds: JSON.parse(r.path_ids),
        createdAt: r.created_at,
      })),
    });
  });

  router.post('/comparisons', requireUser, (req, res) => {
    const pathIds = (Array.isArray(req.body?.pathIds) ? req.body.pathIds : [])
      .filter((id) => content.paths.some((p) => p.id === id))
      .slice(0, 3);
    if (pathIds.length < 2) return res.status(400).json({ error: 'Pick at least two paths to compare' });

    const label =
      String(req.body?.label || '').trim() ||
      pathIds.map((id) => content.paths.find((p) => p.id === id).name).join(' vs ');

    const info = db
      .prepare('INSERT INTO saved_comparisons (user_id, label, path_ids, created_at) VALUES (?, ?, ?, ?)')
      .run(req.user.id, label, JSON.stringify(pathIds), nowIso());
    res.status(201).json({ id: info.lastInsertRowid, label, pathIds });
  });

  router.delete('/comparisons/:id', requireUser, (req, res) => {
    db.prepare('DELETE FROM saved_comparisons WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ ok: true });
  });

  router.post('/quiz', requireUser, (req, res) => {
    const answers = req.body?.answers || {};
    const ranking = scoreQuiz(answers);
    db.prepare('INSERT INTO quiz_results (user_id, answers, ranking, taken_at) VALUES (?, ?, ?, ?)').run(
      req.user.id,
      JSON.stringify(answers),
      JSON.stringify(ranking),
      nowIso(),
    );
    res.json({ ranking });
  });

  /**
   * Public portfolio page. Deliberately unauthenticated — the point is a link
   * you can put on a job application — so it exposes only what the user chose
   * to publish and never their email.
   */
  router.get('/portfolio/:slug', (req, res) => {
    const user = db
      .prepare('SELECT * FROM users WHERE portfolio_slug = ? AND portfolio_public = 1')
      .get(req.params.slug);
    if (!user) return res.status(404).json({ error: 'No public portfolio at this address' });

    const rows = listProgress(db, user.id).filter((r) => r.status === 'done');
    const summary = summarize(listProgress(db, user.id));
    const completed = rows
      .map((row) => ({ row, found: getStep(row.stepId) }))
      .filter((x) => x.found)
      .map(({ row, found }) => ({
        stepId: row.stepId,
        pathId: found.pathId,
        pathName: found.pathName,
        title: found.step.title,
        type: found.step.type,
        completedAt: row.completedAt,
        resumeBullet: found.step.resumeBullet,
        portfolioItem: !!found.step.portfolioItem,
      }));

    res.json({
      displayName: user.display_name,
      headline: user.headline,
      primaryPath: user.primary_path,
      badges: listBadges(db, user.id).filter((b) => b.earned),
      certifications: completed.filter((c) => c.type === 'certification'),
      projects: completed.filter((c) => c.type === 'project'),
      skills: completed.filter((c) => c.type === 'skill'),
      experience: completed.filter((c) => c.type === 'experience'),
      paths: summary.perPath.filter((p) => p.touched),
      totals: { completed: summary.totalCompleted, hours: summary.totalHours },
    });
  });

  return router;
}

/**
 * Quiz scoring: sum the weights of chosen options, then apply the situational
 * penalties (no PC, free-only) so recommendations respect real constraints
 * rather than just interests.
 */
export function scoreQuiz(answers) {
  const scores = new Map(content.paths.map((p) => [p.id, 0]));
  const flags = new Set();

  for (const question of content.quiz.questions) {
    const given = answers[question.id];
    const chosen = Array.isArray(given) ? given : given ? [given] : [];
    for (const optionId of chosen) {
      const option = question.options.find((o) => o.id === optionId);
      if (!option) continue;
      for (const [pathId, weight] of Object.entries(option.weights || {})) {
        if (scores.has(pathId)) scores.set(pathId, scores.get(pathId) + weight);
      }
      for (const [flag, on] of Object.entries(option.flags || {})) {
        if (on) flags.add(flag);
      }
    }
  }

  const notes = [];
  for (const flag of flags) {
    const effect = content.quiz.flagEffects[flag];
    if (!effect) continue;
    notes.push(effect.note);
    for (const [pathId, penalty] of Object.entries(effect.penalties)) {
      if (scores.has(pathId)) scores.set(pathId, scores.get(pathId) + penalty);
    }
  }

  const ranked = [...scores.entries()]
    .map(([pathId, score]) => ({
      pathId,
      score,
      name: content.paths.find((p) => p.id === pathId).name,
    }))
    .sort((a, b) => b.score - a.score);

  return { ranked, notes, flags: [...flags] };
}
