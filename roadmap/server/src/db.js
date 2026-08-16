import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  weekly_hours    INTEGER NOT NULL DEFAULT 8,
  theme           TEXT NOT NULL DEFAULT 'system',
  share_progress  INTEGER NOT NULL DEFAULT 0,
  portfolio_slug  TEXT UNIQUE,
  portfolio_public INTEGER NOT NULL DEFAULT 0,
  headline        TEXT,
  primary_path    TEXT,
  nudge_days      INTEGER NOT NULL DEFAULT 7,
  onboarded       INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  last_progress_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_id      TEXT NOT NULL,
  path_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'not_started',
  notes        TEXT NOT NULL DEFAULT '',
  hours_logged REAL NOT NULL DEFAULT 0,
  cost_spent   REAL NOT NULL DEFAULT 0,
  started_at   TEXT,
  completed_at TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, step_id)
);

CREATE TABLE IF NOT EXISTS earned_badges (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  TEXT NOT NULL,
  earned_at TEXT NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS saved_comparisons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  path_ids   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers     TEXT NOT NULL,
  ranking     TEXT NOT NULL,
  taken_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_progress_user_path ON progress(user_id, path_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

export function openDb(file = process.env.DATABASE_FILE || join(serverRoot, 'data', 'roadmap.sqlite')) {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export const nowIso = () => new Date().toISOString();
