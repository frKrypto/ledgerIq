import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, connectionStringFromEnv, assertRoleCannotBypassRls } from '@ledgeriq/db';
import { buildDashboard, drilldown, resolveOrg } from './dashboard.js';

/**
 * Demo web server.
 *
 * Deliberately a plain Node HTTP server rather than Next.js. The point of this
 * app is to prove the metric engine produces correct numbers and that the design
 * renders them — not to litigate a frontend framework. Next.js arrives with the
 * real onboarding flow in sprint 7; standing it up now would add a build step
 * and a dependency tree in exchange for nothing this app needs.
 *
 * Every figure served here is computed by @ledgeriq/metrics from rows that came
 * through the real ingestion pipeline. Nothing on this page is hardcoded.
 */

const PORT = Number(process.env['WEB_PORT'] ?? 4100);
const HERE = dirname(fileURLToPath(import.meta.url));

const pool = createPool({
  connectionString: connectionStringFromEnv(),
  applicationName: 'ledgeriq-web',
  maxConnections: 8,
});

// Same startup guarantee as the API: refuse to serve if the connected role can
// bypass row-level security.
await assertRoleCannotBypassRls(pool);

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    try {
      if (url.pathname === '/api/dashboard') {
        const org = await resolveOrg(url.searchParams.get('org') ?? undefined);
        if (!org) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'No organization found. Run `npm run demo` first.' }));
          return;
        }
        const data = await buildDashboard(pool, org);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }

      if (url.pathname === '/api/drilldown') {
        const org = await resolveOrg(url.searchParams.get('org') ?? undefined);
        if (!org) {
          res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
          return;
        }
        const rows = await drilldown(pool, org.id, {
          statement: url.searchParams.get('statement'),
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ rows }));
        return;
      }

      if (url.pathname === '/favicon.ico') {
        // Inline SVG: the ledger rule resolving into a rising line, per the
        // brand mark. Avoids a 404 on every page load.
        res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
        res.end(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
             <path d="M3 17h7" stroke="#4e5459" stroke-width="2.4" stroke-linecap="round"/>
             <path d="M10 17c4 0 5-3.2 7-6.4S20.4 5 21 4.6" stroke="#0f8a6a" stroke-width="2.4"
                   stroke-linecap="round"/>
             <circle cx="21" cy="4.6" r="2" fill="#0f8a6a"/></svg>`,
        );
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = await readFile(join(HERE, 'app.html'), 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`\n  LedgerIQ  →  http://localhost:${PORT}\n`);
});
