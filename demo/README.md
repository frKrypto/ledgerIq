# Shareable demo snapshot

`ledgeriq-dashboard-snapshot.html` is a **generated file**, checked in on purpose.

The running demo needs Postgres, a seeded database, and two processes. That is fine for whoever
ran `npm run demo` and useless for everyone they want to show it to. This is the same dashboard
with the figures computed once and frozen in — one file, no server, no network. Open it directly
from disk, email it, or drop it on any static host.

**It is a snapshot, not a live app.** Nothing in it updates, there is no database behind it, and
the business is synthetic — a 22-person agency generated with deliberately messy books. The page
says so at the top; don't remove that.

Every figure in it came out of `buildDashboard()` — the same function the live server calls — over
rows that went through the real ingestion pipeline. The only fake component is Intuit.

## Regenerating

```bash
npm run demo          # seed + ingest, if you haven't
npm run export        # → dist/ledgeriq-demo.html and dist/ledgeriq-demo.body.html
cp dist/ledgeriq-demo.html demo/ledgeriq-dashboard-snapshot.html
```

`--org=<name>` picks a specific organization; `--out=<dir>` changes where the files land.

`ledgeriq-demo.body.html` is the same page without the document skeleton, for hosts that supply
their own `<head>`.
