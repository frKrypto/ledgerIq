/**
 * Synthetic business generator, in QuickBooks Online's response shape.
 *
 * This is NOT a shortcut around the ingestion pipeline. The generated records are
 * served by the fake QBO HTTP server and pulled through the real adapter,
 * archive, checkpointing, and normalization path. The only thing being faked is
 * Intuit.
 *
 * The business it generates — a 22-person agency, the primary persona from
 * prd.md §3.1 — is deliberately built to exhibit the conditions the product
 * exists to detect, because a smooth synthetic business proves nothing:
 *
 *   - Payroll every two weeks, which is the wedge
 *   - Customers who pay late in a *per-customer* pattern, not a uniform one
 *   - Revenue concentration in one account, so concentration risk is real
 *   - A margin decline caused by a specific driver, so decomposition has
 *     something true to find
 *   - Seasonality, so a naive trailing average is visibly wrong
 *   - A genuine cash trough that puts one payroll at risk
 *   - Some uncategorized expenses, because real books always have them
 *
 * Seeded and deterministic: the same seed produces the same business, so a
 * number that looks wrong can be investigated rather than re-rolled.
 */

export interface GeneratedBusiness {
  readonly Account: unknown[];
  readonly Customer: unknown[];
  readonly Vendor: unknown[];
  readonly Invoice: unknown[];
  readonly Payment: unknown[];
  readonly Purchase: unknown[];
  readonly Bill: unknown[];
}

/** Mulberry32 — small, fast, and deterministic across platforms. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date): string => d.toISOString();
const day = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000);
const money = (n: number): number => Math.round(n * 100) / 100;

/** QuickBooks stamps every record with this envelope. */
const meta = (created: Date, updated?: Date) => ({
  CreateTime: iso(created),
  LastUpdatedTime: iso(updated ?? created),
});

interface CustomerSpec {
  readonly name: string;
  /** Share of revenue. The first is deliberately large — concentration risk. */
  readonly share: number;
  /** Days late relative to terms. Per-customer, because that is how reality works. */
  readonly meanDaysLate: number;
  readonly stddevDaysLate: number;
  readonly termsDays: number;
}

const CUSTOMERS: CustomerSpec[] = [
  { name: 'Vertex Industries',    share: 0.34, meanDaysLate: 22, stddevDaysLate: 9, termsDays: 30 },
  { name: 'Harbor Logistics',     share: 0.18, meanDaysLate: 6,  stddevDaysLate: 4, termsDays: 30 },
  { name: 'Cedar & Co',           share: 0.14, meanDaysLate: 2,  stddevDaysLate: 3, termsDays: 15 },
  { name: "O'Brien Partners",     share: 0.11, meanDaysLate: 34, stddevDaysLate: 14, termsDays: 30 },
  { name: 'Northwind Retail',     share: 0.09, meanDaysLate: 11, stddevDaysLate: 6, termsDays: 30 },
  { name: 'Lumen Health',         share: 0.07, meanDaysLate: 4,  stddevDaysLate: 3, termsDays: 15 },
  { name: 'Pike Street Studio',   share: 0.04, meanDaysLate: 1,  stddevDaysLate: 2, termsDays: 15 },
  { name: 'Ridgeline Ventures',   share: 0.03, meanDaysLate: 48, stddevDaysLate: 20, termsDays: 45 },
];

/**
 * Chart of accounts, deliberately imperfect.
 *
 * Includes the things that make real charts hard: inconsistent naming
 * conventions, an ambiguous "Misc" account, and a personal-looking expense
 * account. The mapping layer has to cope, and the onboarding flow has to ask
 * about the ambiguous ones rather than guess.
 */
const ACCOUNTS = [
  { id: '1',  name: 'Business Checking',        type: 'Bank',              sub: 'Checking' },
  { id: '2',  name: 'Business Savings',         type: 'Bank',              sub: 'Savings' },
  { id: '3',  name: 'AmEx Platinum',            type: 'Credit Card',       sub: 'CreditCard' },
  { id: '10', name: 'Consulting Income',        type: 'Income',            sub: 'ServiceFeeIncome' },
  { id: '11', name: 'Retainer Income',          type: 'Income',            sub: 'ServiceFeeIncome' },
  { id: '20', name: 'Subcontractor Costs',      type: 'Cost of Goods Sold',sub: 'SuppliesMaterialsCogs' },
  { id: '21', name: 'Cloud Hosting',            type: 'Cost of Goods Sold',sub: 'OtherCostsOfServiceCos' },
  { id: '30', name: 'Salaries & Wages',         type: 'Expense',           sub: 'PayrollExpenses' },
  { id: '31', name: 'Payroll Taxes',            type: 'Expense',           sub: 'PayrollTaxExpenses' },
  { id: '32', name: 'Employee Benefits',        type: 'Expense',           sub: 'PayrollExpenses' },
  { id: '40', name: 'Rent',                     type: 'Expense',           sub: 'RentOrLeaseOfBuildings' },
  { id: '41', name: 'Software Subscriptions',   type: 'Expense',           sub: 'OfficeGeneralAdministrativeExpenses' },
  { id: '42', name: 'Marketing & Advertising',  type: 'Expense',           sub: 'AdvertisingPromotional' },
  { id: '43', name: 'Travel',                   type: 'Expense',           sub: 'Travel' },
  { id: '44', name: 'Legal & Professional',     type: 'Expense',           sub: 'LegalProfessionalFees' },
  { id: '45', name: 'Insurance',                type: 'Expense',           sub: 'Insurance' },
  { id: '46', name: 'Utilities',                type: 'Expense',           sub: 'Utilities' },
  { id: '47', name: 'Office Supplies',          type: 'Expense',           sub: 'OfficeGeneralAdministrativeExpenses' },
  // The ambiguous one. COGS or overhead? Onboarding has to ask.
  { id: '48', name: 'Contractor Costs - Misc.', type: 'Expense',           sub: 'OtherMiscellaneousServiceCost' },
  { id: '49', name: 'Meals & Entertainment',    type: 'Expense',           sub: 'EntertainmentMeals' },
];

const VENDORS = [
  { name: 'Amazon Web Services',  account: '21', monthly: 4200,  drift: 0.028 },
  { name: 'Figma',                account: '41', monthly: 540,   drift: 0.02 },
  { name: 'Slack',                account: '41', monthly: 420,   drift: 0.015 },
  { name: 'Adobe Creative Cloud', account: '41', monthly: 780,   drift: 0.01 },
  { name: 'Notion',               account: '41', monthly: 190,   drift: 0.03 },
  // Two overlapping design tools — the "duplicate vendors" leak the product
  // is supposed to surface.
  { name: 'Sketch',               account: '41', monthly: 220,   drift: 0 },
  { name: 'Linear',               account: '41', monthly: 310,   drift: 0.04 },
  { name: 'Harborview Properties',account: '40', monthly: 9800,  drift: 0 },
  { name: 'Sterling Insurance',   account: '45', monthly: 1450,  drift: 0.004 },
  { name: 'City Power & Light',   account: '46', monthly: 680,   drift: 0 },
  { name: 'Meridian Legal',       account: '44', monthly: 2200,  drift: 0 },
];

export interface AgencyOptions {
  readonly seed?: number;
  readonly months?: number;
  /** "Today" for the generated business. Everything is relative to this. */
  readonly asOf?: Date;
}

export function generateAgency(options: AgencyOptions = {}): GeneratedBusiness {
  const rand = rng(options.seed ?? 20260727);
  const months = options.months ?? 24;
  const asOf = options.asOf ?? new Date();
  const start = new Date(asOf);
  // months-1 so the loop's final iteration IS the current (partial) month.
  // Ending a month early leaves month-to-date metrics empty, which reads as a
  // broken product rather than a quiet off-by-one.
  start.setMonth(start.getMonth() - (months - 1));

  // Box-Muller, for payment-lag draws that are actually normal rather than
  // uniform. Uniform lateness is unrealistic and would make the per-customer
  // distribution modelling look better than it deserves.
  const normal = (mean: number, sd: number): number => {
    const u = Math.max(rand(), 1e-9);
    const v = Math.max(rand(), 1e-9);
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const Account = ACCOUNTS.map((a) => ({
    Id: a.id,
    Name: a.name,
    FullyQualifiedName: a.name,
    AccountType: a.type,
    AccountSubType: a.sub,
    Active: true,
    Classification:
      a.type === 'Bank' ? 'Asset' : a.type === 'Credit Card' ? 'Liability'
      : a.type === 'Income' ? 'Revenue' : 'Expense',
    CurrentBalance: 0,
    MetaData: meta(start),
  }));

  const Customer = CUSTOMERS.map((c, i) => ({
    Id: String(100 + i),
    DisplayName: c.name,
    CompanyName: c.name,
    PrimaryEmailAddr: { Address: `ap@${c.name.toLowerCase().replace(/[^a-z]/g, '')}.com` },
    Balance: 0,
    Active: true,
    MetaData: meta(start),
  }));

  const Vendor = VENDORS.map((v, i) => ({
    Id: String(200 + i),
    DisplayName: v.name,
    Active: true,
    MetaData: meta(start),
  }));

  const Invoice: unknown[] = [];
  const Payment: unknown[] = [];
  const Purchase: unknown[] = [];
  const Bill: unknown[] = [];

  let invoiceNo = 1000;
  let txnId = 1;

  // Baseline monthly revenue, growing ~12%/yr with Q4-heavy seasonality.
  //
  // Calibrated so the business is realistically profitable: ~$3M/yr across 22
  // people is ~$140K revenue per head, which is normal for an agency. The first
  // pass used $182K/month and produced a business losing money every month —
  // fine as a stress case, useless as the default demo, because every margin
  // and runway figure downstream was negative.
  const baseMonthly = 250_000;

  for (let m = 0; m < months; m++) {
    const monthStart = new Date(start);
    monthStart.setMonth(monthStart.getMonth() + m);
    monthStart.setDate(1);
    const monthIndex = monthStart.getMonth();

    const growth = 1 + (0.12 * m) / 12;
    // Agencies are Q4-heavy and Q1-light. A trailing average misses this
    // entirely, which is the point of having it here.
    const seasonal = [0.86, 0.9, 1.02, 1.0, 1.04, 1.0, 0.92, 0.9, 1.06, 1.12, 1.15, 0.95][monthIndex] ?? 1;
    const monthRevenue = baseMonthly * growth * seasonal * (0.96 + rand() * 0.08);

    // ── Invoices, one per customer per month ───────────────────────────────
    for (const [ci, spec] of CUSTOMERS.entries()) {
      // The margin story: from month 14, Vertex's billings flatten while its
      // subcontractor cost keeps climbing. That is a real, findable driver
      // rather than generic noise.
      const flattening = spec.name === 'Vertex Industries' && m >= 14 ? 0.86 : 1;
      const amount = money(monthRevenue * spec.share * flattening * (0.9 + rand() * 0.2));
      if (amount <= 0) continue;

      const issued = addDays(monthStart, Math.floor(rand() * 6) + 1);
      const due = addDays(issued, spec.termsDays);
      const id = String(invoiceNo++);

      // Recent invoices stay open — that is what creates a realistic AR aging
      // profile and gives the forecast something to model.
      const daysLate = Math.max(-3, Math.round(normal(spec.meanDaysLate, spec.stddevDaysLate)));
      const paidOn = addDays(due, daysLate);
      const isPaid = paidOn < asOf;

      Invoice.push({
        Id: id,
        DocNumber: `INV-${id}`,
        TxnDate: day(issued),
        DueDate: day(due),
        CustomerRef: { value: String(100 + ci), name: spec.name },
        TotalAmt: amount,
        Balance: isPaid ? 0 : amount,
        SalesTermRef: { value: String(spec.termsDays) },
        Line: [
          {
            Id: '1',
            Amount: amount,
            DetailType: 'SalesItemLineDetail',
            Description: `${spec.name} — monthly services`,
            SalesItemLineDetail: { ItemAccountRef: { value: '10', name: 'Consulting Income' } },
          },
        ],
        MetaData: meta(issued, isPaid ? paidOn : issued),
      });

      if (isPaid) {
        Payment.push({
          Id: String(5000 + Number(id)),
          TxnDate: day(paidOn),
          CustomerRef: { value: String(100 + ci), name: spec.name },
          TotalAmt: amount,
          DepositToAccountRef: { value: '1', name: 'Business Checking' },
          Line: [{ Amount: amount, LinkedTxn: [{ TxnId: id, TxnType: 'Invoice' }] }],
          MetaData: meta(paidOn),
        });
      }
    }

    // ── Payroll: semi-monthly, the 15th and the last day ───────────────────
    const headcount = 18 + Math.floor(m / 8);
    for (const payDay of [15, new Date(monthStart.getFullYear(), monthIndex + 1, 0).getDate()]) {
      const payDate = new Date(monthStart.getFullYear(), monthIndex, payDay);
      if (payDate >= asOf) continue;
      const gross = money((headcount * 5900) / 2 + rand() * 2000);

      Purchase.push({
        Id: String(txnId++),
        TxnDate: day(payDate),
        PaymentType: 'Check',
        AccountRef: { value: '1', name: 'Business Checking' },
        TotalAmt: gross,
        Line: [{
          Amount: gross,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: `Payroll ${day(payDate)}`,
          AccountBasedExpenseLineDetail: { AccountRef: { value: '30', name: 'Salaries & Wages' } },
        }],
        MetaData: meta(payDate),
      });

      const taxes = money(gross * 0.0765 + gross * 0.012);
      Purchase.push({
        Id: String(txnId++),
        TxnDate: day(payDate),
        PaymentType: 'Check',
        AccountRef: { value: '1', name: 'Business Checking' },
        TotalAmt: taxes,
        Line: [{
          Amount: taxes,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: `Payroll taxes ${day(payDate)}`,
          AccountBasedExpenseLineDetail: { AccountRef: { value: '31', name: 'Payroll Taxes' } },
        }],
        MetaData: meta(payDate),
      });
    }

    // Benefits, monthly
    const benefitsDate = addDays(monthStart, 4);
    if (benefitsDate < asOf) {
      const benefits = money(headcount * 610);
      Purchase.push({
        Id: String(txnId++),
        TxnDate: day(benefitsDate),
        PaymentType: 'CreditCard',
        AccountRef: { value: '3', name: 'AmEx Platinum' },
        TotalAmt: benefits,
        Line: [{
          Amount: benefits,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: 'Health & dental premiums',
          AccountBasedExpenseLineDetail: { AccountRef: { value: '32', name: 'Employee Benefits' } },
        }],
        MetaData: meta(benefitsDate),
      });
    }

    // ── Subcontractors — the margin driver ─────────────────────────────────
    // Grows faster than revenue from month 14 on. Combined with Vertex's
    // flattening billings, gross margin visibly compresses and decomposition
    // can attribute it correctly.
    const subGrowth = m >= 14 ? 1 + (m - 13) * 0.045 : 1;
    const subDate = addDays(monthStart, 8 + Math.floor(rand() * 5));
    if (subDate < asOf) {
      const subAmount = money(monthRevenue * 0.21 * subGrowth * (0.92 + rand() * 0.16));
      Bill.push({
        Id: String(txnId++),
        DocNumber: `SUB-${m}`,
        TxnDate: day(subDate),
        DueDate: day(addDays(subDate, 30)),
        VendorRef: { value: '210', name: 'Contract Studio Partners' },
        TotalAmt: subAmount,
        Balance: subDate > addDays(asOf, -25) ? subAmount : 0,
        Line: [{
          Amount: subAmount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: 'Subcontracted design & build — Vertex account',
          AccountBasedExpenseLineDetail: { AccountRef: { value: '20', name: 'Subcontractor Costs' } },
        }],
        MetaData: meta(subDate),
      });
    }

    // ── Recurring vendors, with subscription creep ─────────────────────────
    for (const vendor of VENDORS) {
      const chargeDate = addDays(monthStart, 2 + Math.floor(rand() * 24));
      if (chargeDate >= asOf) continue;
      const amount = money(vendor.monthly * (1 + vendor.drift * m) * (0.99 + rand() * 0.02));
      Purchase.push({
        Id: String(txnId++),
        TxnDate: day(chargeDate),
        PaymentType: vendor.account === '40' ? 'Check' : 'CreditCard',
        AccountRef: { value: vendor.account === '40' ? '1' : '3' },
        EntityRef: { value: String(200 + VENDORS.indexOf(vendor)), name: vendor.name },
        TotalAmt: amount,
        Line: [{
          Amount: amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: vendor.name,
          AccountBasedExpenseLineDetail: { AccountRef: { value: vendor.account } },
        }],
        MetaData: meta(chargeDate),
      });
    }

    // ── Discretionary spend, plus a few uncategorized ──────────────────────
    const miscCount = 6 + Math.floor(rand() * 8);
    for (let i = 0; i < miscCount; i++) {
      const d = addDays(monthStart, Math.floor(rand() * 28));
      if (d >= asOf) continue;
      // ~8% land in the ambiguous "Misc" account. Real books always have some,
      // and the product has to be honest about what it can't categorize.
      const uncategorized = rand() < 0.08;
      const account = uncategorized
        ? '48'
        : (['42', '43', '47', '49', '44'][Math.floor(rand() * 5)] as string);
      const amount = money(180 + rand() * 2600);
      Purchase.push({
        Id: String(txnId++),
        TxnDate: day(d),
        PaymentType: 'CreditCard',
        AccountRef: { value: '3', name: 'AmEx Platinum' },
        TotalAmt: amount,
        Line: [{
          Amount: amount,
          DetailType: 'AccountBasedExpenseLineDetail',
          Description: uncategorized ? 'Misc contractor payment' : 'Operating expense',
          AccountBasedExpenseLineDetail: { AccountRef: { value: account } },
        }],
        MetaData: meta(d),
      });
    }
  }

  return { Account, Customer, Vendor, Invoice, Payment, Purchase, Bill };
}
