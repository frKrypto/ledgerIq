import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, connectionStringFromEnv, assertRoleCannotBypassRls } from '@ledgeriq/db';
import { buildDashboard, drilldown, resolveOrg, tileDrilldowns } from './dashboard.js';

/**
 * Freeze the dashboard into a single self-contained HTML file.
 *
 * Why this exists: the running demo needs Postgres, a seeded database, and a
 * process. That is fine for the person who ran `npm run demo` and useless for
 * everyone they want to show it to. This produces one file — no server, no
 * network, no dependencies — that can be emailed, dropped on a static host, or
 * opened straight off disk.
 *
 * What it is not: a live product. The figures are computed once, at export time,
 * by the same `buildDashboard` the server calls, and the page says so on its
 * face. Anyone who reads a snapshot as a working app has been misled, so the
 * banner is not optional dressing — it is part of the deliverable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Escaping for a JSON literal embedded in HTML. */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c') // can't close the script element or open a comment
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The Artifact host wraps uploaded content in its own document skeleton, so the
 * body-only variant must not carry <!doctype>, <html>, <head>, or <body>. The
 * <style> block moves into the body, where it applies identically.
 */
function toBodyOnly(html: string): string {
  const style = /<style>[\s\S]*?<\/style>/.exec(html);
  const body = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!style || !body?.[1]) throw new Error('app.html no longer has the expected <style>/<body> shape');
  return `${style[0]}\n${body[1].trim()}\n`;
}

async function main(): Promise<void> {
  const orgName = process.argv.find((a) => a.startsWith('--org='))?.slice(6);
  const outDir = resolve(process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'dist');

  const pool = createPool({
    connectionString: connectionStringFromEnv(),
    applicationName: 'ledgeriq-export',
    maxConnections: 4,
  });
  await assertRoleCannotBypassRls(pool);

  try {
    const org = await resolveOrg(orgName);
    if (!org) {
      console.error('No organization found. Run `npm run demo` first.');
      process.exitCode = 1;
      return;
    }

    const dashboard = await buildDashboard(pool, org);

    // Pre-resolve every drill-down the page can ask for. If a click target had
    // no baked answer the export would look broken in exactly the place the
    // product is trying to prove itself.
    const drilldowns: Record<string, unknown> = {};
    for (const d of tileDrilldowns(dashboard)) {
      drilldowns[d.key] = await drilldown(pool, org.id, d);
    }

    const app = await readFile(join(HERE, 'app.html'), 'utf8');
    const snapshot = `<script>window.__SNAPSHOT__ = ${embedJson({ dashboard, drilldowns })};</script>\n`;
    const injected = app.replace('<script>\n// Two data sources', `${snapshot}<script>\n// Two data sources`);
    if (injected === app) throw new Error('snapshot injection point not found in app.html');

    await mkdir(outDir, { recursive: true });
    const standalone = join(outDir, 'ledgeriq-demo.html');
    const bodyOnly = join(outDir, 'ledgeriq-demo.body.html');
    await writeFile(standalone, injected, 'utf8');
    await writeFile(bodyOnly, toBodyOnly(injected), 'utf8');

    const kb = (s: string): string => `${Math.round(Buffer.byteLength(s) / 1024)} KB`;
    console.log(`\n  ${org.name} — snapshot as of ${new Date().toISOString().slice(0, 10)}`);
    console.log(`  ${Object.keys(drilldowns).length} drill-downs baked in`);
    console.log(`\n  ${standalone}  (${kb(injected)}, open directly in a browser)`);
    console.log(`  ${bodyOnly}  (body-only, for embedding)\n`);
  } finally {
    await pool.end();
  }
}

await main();
