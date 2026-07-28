import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Most of this is conventional. The rules that matter for this codebase
 * specifically are the two under "tenancy guardrails" — they turn documented
 * conventions into mechanical checks, which is the only form a convention
 * survives in.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      'docs/**',
      'infra/**',
      'eslint.config.js',
    ],
  },

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Database work is asynchronous throughout; an unawaited promise is a
      // silently-dropped write or an unhandled rejection.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Financial code should not silently coerce. An `any` here is a number
      // whose provenance nobody can explain.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off', // too noisy against drizzle's generics
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Tenancy guardrails
  // ───────────────────────────────────────────────────────────────────────────
  {
    files: ['**/*.ts'],
    ignores: [
      // The directories legitimately allowed to run without a tenant scope:
      // the implementation itself, migration/admin CLIs, and the suite that
      // exists to prove the escape hatch is not a bypass.
      'packages/db/src/tenant-context.ts',
      'packages/db/src/cli/**',
      'packages/db/src/migrate.ts',
      'packages/db/test/**',
      // Operator/demo surfaces that must resolve an org identity BEFORE a
      // tenant scope can exist. Narrow by construction: these lookups return
      // only an org id or name, never financial data.
      'apps/cli/**',
      'apps/web/src/dashboard.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="unsafeWithoutTenantScope"]',
          message:
            'unsafeWithoutTenantScope runs without a tenant scope. It is permitted only in ' +
            'migrations, admin CLIs, and fleet-wide jobs that fan out per org. If you need ' +
            'tenant data, use withTenant(). If you genuinely need this, add the file to the ' +
            'allowlist in eslint.config.js so the exception is reviewed.',
        },
        {
          // The pool is the raw, unscoped handle. Application code should never
          // reach past withTenant() to it.
          selector: 'CallExpression[callee.property.name="query"][callee.object.name=/^(pool|adminPool)$/]',
          message:
            'Direct pool.query() bypasses the tenant scope. Use withTenant() so row-level ' +
            'security is bound to an organization.',
        },
      ],
    },
  },

  {
    // CLI entrypoints exist to print. Test files assert rather than return.
    files: ['**/src/cli/**/*.ts', 'apps/cli/**/*.ts', 'apps/web/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Assertions inside async callbacks are the point; not every one awaits.
      '@typescript-eslint/require-await': 'off',
    },
  },
);
