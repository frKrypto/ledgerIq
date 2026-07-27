# Running a real QuickBooks backfill locally

The fastest way to find out what real books actually look like — which is the
biggest unknown left before normalization is designed in sprint 3.

---

## 1. Get Intuit sandbox credentials

Free, no billing, ~15 minutes.

1. Sign up at **https://developer.intuit.com** and create an app. Select the
   **Accounting** scope (`com.intuit.quickbooks.accounting`).
2. Under **Keys & credentials → Development**, copy the **Client ID** and
   **Client Secret**.
3. Under **Redirect URIs**, add exactly:
   ```
   http://localhost:4000/callback
   ```
   Intuit requires the redirect URI to match character-for-character, including
   the trailing path. A mismatch fails at the authorize step with an unhelpful
   error.
4. Under **Sandbox**, note the sandbox company Intuit created for you. It comes
   pre-populated with a couple of years of realistic-ish data.

**Worth doing:** open the sandbox company in the QuickBooks UI and make a mess of
it — add an oddly-named account, leave some expenses uncategorized, create a
customer whose name contains an apostrophe. Clean data validates the happy path
that real customers never have.

---

## 2. Configure

```bash
cp .env.example .env
```

Then set:

```bash
QBO_CLIENT_ID=ABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QBO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
QBO_REDIRECT_URI=http://localhost:4000/callback
QBO_SANDBOX=true

# Derives the root key that wraps each tenant's data key. Any passphrase works
# locally. Changing it makes previously stored credentials unreadable — which is
# the point of envelope encryption, but a surprise if you forget.
LOCAL_KMS_ROOT_KEY=any-local-passphrase
```

`QBO_SANDBOX=true` is the default and points at
`sandbox-quickbooks.api.intuit.com`. Setting it to `false` hits **real company
data** — the CLI prints `PRODUCTION` in that mode, deliberately loudly.

---

## 3. Run it

```bash
docker compose up -d postgres
npm run db:migrate
npm -w @ledgeriq/db run bootstrap     # creates the ledgeriq_app role

npm run cli -- connect                # opens the OAuth flow
npm run cli -- sync --connection <id> # 24-month backfill
npm run cli -- status
```

`connect` prints an authorize URL, waits on `localhost:4000` for the callback,
exchanges the code, and stores the credentials encrypted under a per-tenant data
key. It captures `realmId` from the callback — that value is **not** in the token
response and every subsequent API call needs it, so pasting a code by hand
instead of using the callback produces a connection that authenticates and then
fails on every request.

**Interrupting `sync` with Ctrl-C is safe and worth trying deliberately.**
Checkpoints live in Postgres, so re-running the same command resumes from the
last archived page rather than restarting. That is the property most likely to
regress silently, and exercising it by hand once is worth more than trusting the
test.

---

## 4. Look at the data

This is the actual point of the exercise.

```bash
# Field coverage across real records — which fields are sparse, and how sparse
npm run cli -- inspect --connection <id> --type Invoice --fields

# Raw records, exactly as Intuit returned them
npm run cli -- inspect --connection <id> --type Account --limit 5
```

`--fields` is the more useful of the two. A field present in 4% of records is a
normalization hazard: the documentation lists it, the type definition suggests
it's there, and it will be null far more often than either implies.

**Specific things to look at before designing normalization:**

| Question | How |
|---|---|
| How large and how messy is the chart of accounts? | `inspect --type Account --limit 50` |
| Which Invoice fields are actually reliable? | `inspect --type Invoice --fields` |
| Is job/project costing present at all? | Look for `ProjectRef` / `ClassRef` coverage on `Invoice` |
| How are payments linked to invoices? | `inspect --type Payment` and check `Line[].LinkedTxn` |
| Do amounts ever arrive as strings rather than numbers? | Read raw output, not the typed view |

Customer profitability depends on job costing, and most SMB books don't have it.
Finding that out now decides whether it ships in V1.1 or gets deferred — which is
exactly the kind of thing the PRD currently assumes rather than knows.

---

## 5. Without Intuit credentials

The whole CLI path can be exercised against the fake QuickBooks server used in
the tests, by pointing the endpoints at it:

```bash
QBO_API_BASE=http://127.0.0.1:PORT/v3/company
QBO_TOKEN_URL=http://127.0.0.1:PORT/oauth2/v1/tokens/bearer
```

This validates the wiring — sync, checkpointing, reconciliation, freshness — but
**not** the thing that actually matters, which is the shape of real books. It is
a smoke test, not a substitute.

---

## 6. Troubleshooting

| Symptom | Cause |
|---|---|
| `invalid_grant` on connect | Redirect URI doesn't match Intuit's config exactly |
| `Callback missing code or realmId` | Authorize URL was opened without going through Intuit's flow |
| Connection goes `reauth_required` after working | Refresh token rotated but wasn't persisted. The CLI persists on rotation; if you see this, check `onCredentialsRotated` fired. |
| `Decryption failed` | `LOCAL_KMS_ROOT_KEY` changed since the credentials were stored |
| `Refusing to start: application role can bypass RLS` | `DATABASE_URL` points at the owner/superuser role. Use `ledgeriq_app`. |
| Sync stops early with no error | Check `status` for `lastError` on the checkpoint row |

---

## 7. What to write down

The purpose of this exercise is to produce inputs for sprint 3. Worth capturing
as you go:

- Every QBO field the normalization layer will need, and its real coverage
- Any record type whose structure differs from what the adapter assumes
- The actual chart-of-accounts shape, since the canonical category mapping has to
  handle it
- Rate-limit behaviour under a sustained backfill — the adapter self-limits at
  ~7 req/s, and whether that is conservative or optimistic is currently a guess

Anything surprising here should become a fixture in the golden test set before it
becomes an assumption in the metric engine.
