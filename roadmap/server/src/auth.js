import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { nowIso } from './db.js';

const SESSION_DAYS = 60;
const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  // Length check first: timingSafeEqual throws on a length mismatch.
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    nowIso(),
    expires,
  );
  return { token, expires };
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, nowIso());
  return row || null;
}

export const COOKIE_NAME = 'roadmap_session';

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 86400_000,
    path: '/',
  };
}

/** Express middleware: attaches req.user when a valid session cookie is present. */
export function attachUser(db) {
  return (req, _res, next) => {
    req.user = userForToken(db, req.cookies?.[COOKIE_NAME]);
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    weeklyHours: row.weekly_hours,
    theme: row.theme,
    shareProgress: !!row.share_progress,
    portfolioSlug: row.portfolio_slug,
    portfolioPublic: !!row.portfolio_public,
    headline: row.headline,
    primaryPath: row.primary_path,
    nudgeDays: row.nudge_days,
    onboarded: !!row.onboarded,
    createdAt: row.created_at,
    lastProgressAt: row.last_progress_at,
  };
}
