import { createServer } from 'node:http';
import type { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { QuickBooksAdapter } from '@ledgeriq/connectors';
import { withTenant, schema, credentialsRepo, type TenantContext } from '@ledgeriq/db';
import { loadConfig, fmt } from '../context.js';

/**
 * `ledgeriq connect` — run the QuickBooks OAuth flow locally.
 *
 * Intuit requires a redirect URI, so this stands up a one-shot local server to
 * catch the callback. The alternative — pasting a code out of a browser URL bar —
 * works but drops the `realmId` query parameter, which is not part of the token
 * response and is required for every subsequent API call. That is a genuinely
 * easy thing to lose an hour to.
 *
 * The `state` parameter is generated and verified rather than ignored. This is a
 * local dev tool, but CSRF on an OAuth callback is exactly the kind of thing that
 * gets copied verbatim into the production handler later.
 */

interface ConnectArgs {
  readonly orgName?: string;
  readonly port?: number;
}

export async function connect(args: ConnectArgs = {}): Promise<void> {
  const config = await loadConfig({ requireQuickBooks: true });
  const port = args.port ?? Number(new URL(config.quickbooks.redirectUri).port || 4000);

  try {
    // ── 1. Ensure there is an org and a user to attach the connection to ──────
    const { orgId, userId } = await ensureOrg(config.adminPool, args.orgName ?? 'Sandbox Co');
    const ctx: TenantContext = { orgId, actor: { type: 'user', userId } };

    console.log(`\n${fmt.bold('LedgerIQ — connect QuickBooks')}`);
    console.log(fmt.dim(`  org  ${orgId}`));
    console.log(fmt.dim(`  mode ${config.quickbooks.sandbox ? 'sandbox' : 'PRODUCTION'}\n`));

    // ── 2. Build the authorize URL ────────────────────────────────────────────
    const state = randomBytes(16).toString('hex');
    const authorizeUrl = new URL('https://appcenter.intuit.com/connect/oauth2');
    authorizeUrl.searchParams.set('client_id', config.quickbooks.clientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    authorizeUrl.searchParams.set('redirect_uri', config.quickbooks.redirectUri);
    authorizeUrl.searchParams.set('state', state);

    console.log('Open this URL and authorize the sandbox company:\n');
    console.log(fmt.cyan(authorizeUrl.toString()));
    console.log(`\n${fmt.dim(`Waiting for the callback on port ${port}…`)}`);

    // ── 3. Catch the callback ─────────────────────────────────────────────────
    const callback = await waitForCallback(port, state);

    // ── 4. Exchange the code for credentials ──────────────────────────────────
    const adapter = new QuickBooksAdapter({
      clientId: config.quickbooks.clientId,
      clientSecret: config.quickbooks.clientSecret,
      sandbox: config.quickbooks.sandbox,
      ...(config.quickbooks.apiBase ? { apiBase: config.quickbooks.apiBase } : {}),
      ...(config.quickbooks.tokenUrl ? { tokenUrl: config.quickbooks.tokenUrl } : {}),
    });

    const credentials = await adapter.authorize({
      code: callback.code,
      redirectUri: config.quickbooks.redirectUri,
      realmId: callback.realmId,
    });

    // ── 5. Persist, encrypted under this tenant's data key ────────────────────
    const connectionId = await withTenant(config.pool, ctx, async (db) => {
      const [row] = await db
        .insert(schema.connections)
        .values({
          orgId,
          source: 'quickbooks',
          sourceKind: 'accounting',
          displayName: 'QuickBooks Online',
          externalAccountId: callback.realmId,
          realmId: callback.realmId,
          status: 'active',
          connectedBy: userId,
          tokenExpiresAt: credentials.expiresAt,
        })
        .returning({ id: schema.connections.id });

      if (!row) throw new Error('Failed to create connection');
      return row.id;
    });

    await withTenant(config.pool, ctx, async (db) => {
      await credentialsRepo.storeCredentials(db, config.kms, connectionId, {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt.toISOString(),
        externalAccountId: callback.realmId,
      });
    });

    // ── 6. Verify it actually works before claiming success ───────────────────
    const health = await adapter.healthCheck({
      id: connectionId,
      orgId,
      source: 'quickbooks',
      externalAccountId: callback.realmId,
      credentials,
    });

    console.log(`\n${fmt.green('✓')} Connected.`);
    console.log(`  connection  ${fmt.bold(connectionId)}`);
    console.log(`  realm       ${callback.realmId}`);
    console.log(
      `  health      ${health.status === 'healthy' ? fmt.green(health.status) : fmt.yellow(health.status)}`,
    );
    console.log(`\nNext: ${fmt.cyan(`npm run cli -- sync --connection ${connectionId}`)}\n`);
  } finally {
    await config.pool.end();
    await config.adminPool.end();
  }
}

interface CallbackResult {
  readonly code: string;
  readonly realmId: string;
}

function waitForCallback(port: number, expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const realmId = url.searchParams.get('realmId');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      const finish = (status: number, title: string, detail: string): void => {
        res.writeHead(status, { 'content-type': 'text/html' });
        res.end(
          `<!doctype html><meta charset="utf-8">
           <title>LedgerIQ</title>
           <body style="font:15px system-ui;padding:60px;max-width:520px;margin:auto">
             <h2 style="font-weight:600">${title}</h2>
             <p style="color:#4e5459">${detail}</p>
           </body>`,
        );
      };

      if (error) {
        finish(400, 'Authorization failed', error);
        server.close();
        reject(new Error(`QuickBooks returned error: ${error}`));
        return;
      }

      // Constant-time-ish comparison is overkill here, but rejecting a mismatched
      // state at all is the habit worth keeping.
      if (state !== expectedState) {
        finish(400, 'State mismatch', 'The callback did not match this session. Try again.');
        server.close();
        reject(new Error('OAuth state mismatch — possible CSRF, or a stale browser tab'));
        return;
      }

      if (!code || !realmId) {
        finish(400, 'Incomplete callback', 'Missing code or realmId.');
        server.close();
        reject(
          new Error(
            'Callback missing code or realmId. realmId is not part of the token response, ' +
              'so it must be captured here or the connection is unusable.',
          ),
        );
        return;
      }

      finish(200, 'Connected', 'You can close this tab and return to the terminal.');
      server.close();
      resolve({ code, realmId });
    });

    server.listen(port, '127.0.0.1');
    server.on('error', reject);

    setTimeout(
      () => {
        server.close();
        reject(new Error('Timed out waiting for the OAuth callback (5 minutes)'));
      },
      5 * 60_000,
    ).unref();
  });
}

/** Find or create a local org + user. Real signup arrives with onboarding in sprint 7. */
async function ensureOrg(
  pool: Pool,
  name: string,
): Promise<{ orgId: string; userId: string }> {
  // Bootstrapping needs a row that does not exist yet, so it cannot run inside a
  // tenant scope — RLS would (correctly) hide it. This is the narrow, legitimate
  // case for admin-level access, and it is confined to this function.
  const client = await pool.connect();
  try {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE name = $1 LIMIT 1`,
      [name],
    );

    if (existing.rows[0]) {
      const user = await client.query<{ id: string }>(
        `SELECT u.id FROM users u
           JOIN memberships m ON m.user_id = u.id
          WHERE m.org_id = $1 LIMIT 1`,
        [existing.rows[0].id],
      );
      if (user.rows[0]) {
        return { orgId: existing.rows[0].id, userId: user.rows[0].id };
      }
    }

    const org = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, business_model, onboarding_stage)
       VALUES ($1, 'unknown', 'connecting') RETURNING id`,
      [name],
    );
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new Error('Failed to create organization');

    const email = `dev+${randomUUID().slice(0, 8)}@ledgeriq.local`;
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (external_auth_id, email, full_name)
       VALUES ($1, $2, 'Local Developer') RETURNING id`,
      [`local_${randomUUID()}`, email],
    );
    const userId = user.rows[0]?.id;
    if (!userId) throw new Error('Failed to create user');

    await client.query(
      `INSERT INTO memberships (org_id, user_id, role, accepted_at)
       VALUES ($1, $2, 'owner', now())`,
      [orgId, userId],
    );

    return { orgId, userId };
  } finally {
    client.release();
  }
}
