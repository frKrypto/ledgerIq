import express from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { attachUser } from './auth.js';
import { content } from './content.js';
import { authRoutes } from './routes/auth.js';
import { progressRoutes } from './routes/progress.js';
import { socialRoutes } from './routes/social.js';
import { ensureSeedUsers } from './seed.js';

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(attachUser(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true, contentVersion: content.version }));

  // The whole roadmap in one payload. It's static per deploy, so it's cacheable
  // and is exactly what the service worker stores for offline use.
  app.get('/api/content', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(content);
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api/progress', progressRoutes(db));
  app.use('/api', socialRoutes(db));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  // In production the built client is served from the same origin, which keeps
  // cookies first-party and avoids any CORS configuration.
  const clientDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const db = openDb();
  ensureSeedUsers(db);
  const port = Number(process.env.PORT) || 4000;
  createApp(db).listen(port, () => {
    console.log(`roadmap api listening on http://localhost:${port} (content ${content.version})`);
  });
}
