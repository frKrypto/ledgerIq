import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/core/test/**/*.test.ts', 'packages/crypto/test/**/*.test.ts', 'packages/connectors/test/**/*.test.ts', 'packages/alerts/test/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'tenancy',
      include: ['packages/db/test/**/*.test.ts'],
      environment: 'node',
      // Isolation cases share one database; parallel files would make failures
      // non-deterministic and undermine the guarantee this suite provides.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  },
]);
