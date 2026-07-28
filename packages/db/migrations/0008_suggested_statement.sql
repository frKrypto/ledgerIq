-- 0008 — record where we think an account belongs when we disagree with the books.
--
-- The reconciliation harness surfaced a $12,979 COGS divergence with no code
-- defect behind it: our name heuristic was reclassifying "Contractor Costs -
-- Misc." from Expense to COGS, because subcontractor cost genuinely is COGS when
-- it is billable project work.
--
-- Being right about the accounting does not make it right to apply. The customer
-- can open QuickBooks and pull their own P&L; if ours says 65% gross margin and
-- theirs says 61%, we are not delivering insight, we are losing an argument we
-- cannot win. The source system is authoritative for classification.
--
-- The disagreement is still valuable — it is exactly the question worth asking
-- during chart-of-accounts confirmation. So it is stored rather than discarded,
-- and applied only if the owner says yes.
ALTER TABLE ledger_accounts
    ADD COLUMN suggested_statement statement_class;

COMMENT ON COLUMN ledger_accounts.suggested_statement IS
    'Where we suspect this account belongs, when it differs from the source system''s '
    'classification. Never applied without the owner confirming it during onboarding.';

-- Onboarding asks about these, so it needs to find them cheaply.
CREATE INDEX ledger_accounts_suggestion_idx
    ON ledger_accounts (org_id) WHERE suggested_statement IS NOT NULL;
