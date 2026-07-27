import { createPool, connectionStringFromEnv } from '../client.js';
import { migrate } from '../migrate.js';

const pool = createPool({
  connectionString: process.env['ADMIN_DATABASE_URL'] ?? connectionStringFromEnv(),
  applicationName: 'ledgeriq-migrate',
});

try {
  const result = await migrate(pool, { log: (m) => console.log(m) });
  console.log(
    result.applied.length
      ? `applied ${result.applied.length} migration(s)`
      : `up to date (${result.skipped.length} already applied)`,
  );
} finally {
  await pool.end();
}
