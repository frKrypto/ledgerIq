import { hashPassword } from './auth.js';
import { nowIso } from './db.js';
import { slugify } from './util.js';

/**
 * This is a two-person tool, so accounts are seeded rather than opened to
 * public signup. Passwords come from the environment in production; the
 * fallbacks exist so a fresh clone runs without configuration.
 */
const SEED_USERS = [
  {
    email: process.env.ERIC_EMAIL || 'eric@roadmap.local',
    displayName: 'Eric',
    passwordEnv: 'ERIC_PASSWORD',
    fallbackPassword: 'change-me-eric',
  },
  {
    email: process.env.MATT_EMAIL || 'matt@roadmap.local',
    displayName: 'Matt',
    passwordEnv: 'MATT_PASSWORD',
    fallbackPassword: 'change-me-matt',
  },
];

export function ensureSeedUsers(db) {
  const created = [];

  for (const seed of SEED_USERS) {
    const email = seed.email.toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) continue;

    const password = process.env[seed.passwordEnv] || seed.fallbackPassword;
    if (!process.env[seed.passwordEnv] && process.env.NODE_ENV === 'production') {
      console.warn(
        `[seed] ${seed.passwordEnv} is not set — ${seed.displayName}'s account uses the default password. Set it and restart.`,
      );
    }

    db.prepare(
      `INSERT INTO users (email, password_hash, display_name, portfolio_slug, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(email, hashPassword(password), seed.displayName, slugify(seed.displayName), nowIso());

    created.push({ email, displayName: seed.displayName });
  }

  return created;
}
