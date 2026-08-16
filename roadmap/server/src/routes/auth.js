import { Router } from 'express';
import {
  COOKIE_NAME,
  cookieOptions,
  createSession,
  destroySession,
  hashPassword,
  publicUser,
  requireUser,
  verifyPassword,
} from '../auth.js';
import { nowIso } from '../db.js';
import { slugify } from '../util.js';

export function authRoutes(db) {
  const router = Router();

  router.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email or password is incorrect' });
    }

    const { token } = createSession(db, user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ user: publicUser(user) });
  });

  router.post('/signup', (req, res) => {
    if (process.env.ALLOW_SIGNUP === 'false') {
      return res.status(403).json({ error: 'Signup is closed on this instance' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || '').trim() || email.split('@')[0];

    if (!email.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'That email already has an account' });
    }

    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, portfolio_slug, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(email, hashPassword(password), displayName, uniqueSlug(db, displayName), nowIso());

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const { token } = createSession(db, user.id);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/logout', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (token) destroySession(db, token);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: publicUser(req.user) });
  });

  router.patch('/me', requireUser, (req, res) => {
    const current = req.user;
    const body = req.body || {};
    const fields = {
      display_name: body.displayName !== undefined ? String(body.displayName).slice(0, 80) : current.display_name,
      weekly_hours:
        body.weeklyHours !== undefined
          ? Math.min(80, Math.max(1, Math.round(Number(body.weeklyHours) || 1)))
          : current.weekly_hours,
      theme: ['light', 'dark', 'system'].includes(body.theme) ? body.theme : current.theme,
      share_progress: body.shareProgress !== undefined ? (body.shareProgress ? 1 : 0) : current.share_progress,
      portfolio_public: body.portfolioPublic !== undefined ? (body.portfolioPublic ? 1 : 0) : current.portfolio_public,
      headline: body.headline !== undefined ? String(body.headline).slice(0, 200) : current.headline,
      primary_path: body.primaryPath !== undefined ? body.primaryPath : current.primary_path,
      nudge_days:
        body.nudgeDays !== undefined ? Math.min(90, Math.max(0, Math.round(Number(body.nudgeDays) || 0))) : current.nudge_days,
      onboarded: body.onboarded !== undefined ? (body.onboarded ? 1 : 0) : current.onboarded,
    };

    db.prepare(
      `UPDATE users SET display_name = ?, weekly_hours = ?, theme = ?, share_progress = ?,
        portfolio_public = ?, headline = ?, primary_path = ?, nudge_days = ?, onboarded = ?
       WHERE id = ?`,
    ).run(
      fields.display_name,
      fields.weekly_hours,
      fields.theme,
      fields.share_progress,
      fields.portfolio_public,
      fields.headline,
      fields.primary_path,
      fields.nudge_days,
      fields.onboarded,
      current.id,
    );

    res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(current.id)) });
  });

  return router;
}

function uniqueSlug(db, displayName) {
  const base = slugify(displayName) || 'user';
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT id FROM users WHERE portfolio_slug = ?').get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}
