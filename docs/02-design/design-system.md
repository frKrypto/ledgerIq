# Design System

Implements the visual direction in [brand-identity.md](brand-identity.md). Every color value here
has been **computationally validated** — see §2.5 for the verification record.

Working reference: [ui-concept.html](ui-concept.html).

---

## 1. Foundations

**Grid:** 4px base unit. Everything is a multiple of 4.

**Density:** this is a financial product for people who want information. Default to the denser end
of comfortable — 32px row height for tables, not 56px. Density comes from consistent, tight spacing,
never from reducing type size below legibility.

**Radius:** 6px default, 10px for cards, 4px for the rounded data-ends on chart marks, full for
pills. Nothing more rounded than 10px — high radii read as consumer/playful, which is the opposite
of the positioning.

**Elevation:** two levels only. Cards sit on the surface with a hairline border, no shadow. Overlays
(dialog, popover, tooltip) get a soft shadow. Shadow is not used decoratively; if everything floats,
nothing does.

---

## 2. Color

### 2.1 Surfaces and ink

| Token | Light | Dark |
|---|---|---|
| `--surface-page` | `#f6f6f4` | `#0b0e11` |
| `--surface-1` (cards, chart surface) | `#fbfbfa` | `#111417` |
| `--surface-2` (raised, hover) | `#f0f0ed` | `#181c20` |
| `--border-subtle` | `#e3e3df` | `#232830` |
| `--border-strong` | `#c9c9c3` | `#333a44` |
| `--text-primary` | `#111417` | `#f4f5f3` |
| `--text-secondary` | `#4e5459` | `#a8b0b8` |
| `--text-muted` | `#767c82` | `#6f777f` |

The dark base is a near-black with a blue undertone (`#0b0e11`), not neutral gray and not pure
black. Pure black on a screen full of numbers is harsh over a long session.

### 2.2 Brand

| Token | Light | Dark |
|---|---|---|
| `--brand` | `#0f8a6a` | `#14a37d` |
| `--brand-hover` | `#0b6b53` | `#34b489` |
| `--brand-subtle` (backgrounds) | `#e7f5ef` | `#0d2a22` |

### 2.3 Categorical series — validated, fixed order

**Assign in this order. Never cycle, never generate a 7th hue.** A 7th series folds into "Other" or
becomes small multiples.

| Slot | Hue | Light | Dark | Typical use |
|---|---|---|---|---|
| 1 | teal (brand) | `#0f8a6a` | `#14a37d` | Cash, the primary series |
| 2 | blue | `#2a78d6` | `#3987e5` | Revenue |
| 3 | orange | `#eb6834` | `#d95926` | Expenses |
| 4 | violet | `#4a3aa7` | `#9085e9` | Payroll |
| 5 | yellow | `#eda100` | `#c98500` | Taxes |
| 6 | magenta | `#e87ba4` | `#d55181` | Other |

**Red is deliberately absent from the categorical palette.** It's reserved for status
(§2.4). A red series next to a red "critical" badge makes both meaningless — and in a financial UI,
red already carries an unavoidable connotation of loss.

### 2.4 Status — reserved, never used as series colors

Always shipped with an icon and a label, never color alone.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `--status-positive` | `#0e7c5a` | `#3fbf94` | Favorable |
| `--status-caution` | `#9a6100` | `#e0a63c` | Watch |
| `--status-serious` | `#b4480f` | `#f08a4b` | Needs action |
| `--status-critical` | `#c2312f` | `#f2706e` | Urgent |

### 2.5 Verification record

Validated with the data-viz palette validator (OKLab ΔE ×100, Machado-Oliveira-Fernandes CVD
simulation at severity 1.0, WCAG contrast).

**Categorical, 6 slots, adjacent pairs — PASS in both modes:**

| Check | Light (surface `#fbfbfa`) | Dark (surface `#111417`) |
|---|---|---|
| Lightness band | PASS — all inside L 0.43–0.77 | PASS — all inside L 0.48–0.67 |
| Chroma floor | PASS — all ≥ 0.10 | PASS |
| CVD separation | PASS — worst adjacent ΔE **16.3** (magenta↔yellow, deutan) | PASS — worst adjacent ΔE **13.2** |
| Normal-vision floor | PASS — worst adjacent ΔE **19.2** (blue↔teal) | PASS — **19.3** |
| Contrast vs surface | WARN — yellow 2.09:1, magenta 2.60:1 | PASS — all ≥ 3:1 |

**The light-mode contrast WARN is not dismissable.** Yellow (slot 5) and magenta (slot 6) fall below
3:1 on the light surface, which means any chart using 5+ series in light mode **must** ship visible
direct labels or a table view. This is a real constraint on chart design, not a footnote — it's why
the mark specs in §6 make direct labeling the default rather than an enhancement.

**All-pairs (scatter, bubble, small multiples):** the series cap is **4 slots**, and teal↔orange
sits at CVD ΔE 6.7 in light mode — inside the 6–8 warn band, legal only with secondary encoding.
For scatter-type charts, either cap at 3 series or ship shape encoding alongside color. Dark mode
clears all-pairs at 3 slots with ΔE 10.5.

**Sequential/ordinal teal ramp — PASS in both modes** (monotone lightness, adjacent ΔL ≥ 0.06,
light end clears 2:1):

| | Steps (light→dark) |
|---|---|
| Light mode | `#34b489` → `#0f8a6a` → `#0b6b53` → `#08503e` |
| Dark mode | `#d3f0e4` → `#a6e0c9` → `#6ecdaa` → `#34b489` |

Light mode must not start lighter than `#34b489` (2.52:1); a lighter first step fails the floor.
Dark mode must not end darker than `#34b489`.

**Status colors — all PASS text contrast (≥4.5:1) in both modes:** positive 5.01/8.00, caution
4.97/8.53, serious 5.23/7.43, critical 5.37/6.44.

### 2.6 The direction-vs-sentiment rule

**Never color a number by whether it went up or down.** Expenses down is good; margin down is bad.
Both are "down."

Color on the semantic `is_favorable` field the API returns
([api-spec §3](../03-engineering/api-spec.md#3-conventions)), never on `direction`. The arrow glyph
shows direction; the color shows whether that's good. Getting this backwards is a small detail that
makes a finance product feel fundamentally unserious to anyone who reads financial statements.

---

## 3. Typography

**Families**
- **UI:** Inter — `--font-ui`
- **Numerals:** Inter with `font-variant-numeric: tabular-nums` — **always, everywhere a number
  appears.** Non-tabular figures shift horizontally as values update, which makes a live dashboard
  look broken.
- **Long-form** (AI answers, reports, weekly brief): Source Serif — `--font-reading`. Signals
  "document," improves sustained readability, and visually separates the CFO's *reasoning* from the
  app's *chrome*.

**Scale** (1.200 minor third, 4px-aligned)

| Token | Size / line-height | Use |
|---|---|---|
| `display` | 40 / 44 | Hero figures — the number on a stat tile |
| `h1` | 30 / 36 | Page title |
| `h2` | 24 / 32 | Section |
| `h3` | 19 / 28 | Card title |
| `body-lg` | 17 / 28 | AI answer headline, brief body (serif) |
| `body` | 15 / 24 | Default |
| `body-sm` | 13 / 20 | Secondary, table cells |
| `caption` | 12 / 16 | Labels, axis ticks, metadata |
| `mono` | 13 / 20 | IDs, code, raw values |

**Weights:** 400 body, 500 emphasis and labels, 600 headings and figures. No 700+ — heavy weights
read as shouting, which conflicts with the calm register.

---

## 4. Spacing & layout

Scale: `0, 4, 8, 12, 16, 24, 32, 48, 64, 96`.

**App shell:** persistent left nav (collapsible, 240px / 64px), top bar with org switcher, data
freshness indicator, and search. Content max-width 1440px; reading surfaces (reports, answers) cap at
72ch regardless of viewport, because line length is a readability constraint, not a layout one.

**Breakpoints:** 640 / 1024 / 1280 / 1536. Below 1024 the nav collapses and charts stack. Tables
become card lists below 640 rather than scrolling horizontally — a horizontally-scrolling financial
table on a phone is unreadable.

---

## 5. Components

### 5.1 Figure — the most important component in the product

Every number the product displays is a `Figure`. It is never a bare string.

```
┌─────────────────────────────────┐
│ Runway                       ⓘ  │  ← label + assumption/definition tooltip
│ 7.2 months                      │  ← display size, tabular, brand color if primary
│ ▲ 0.4 vs last month             │  ← direction glyph + colored by is_favorable
│ ─────────────────────────────── │
│ High confidence · as of 6:00am  │  ← confidence + freshness, always present
└─────────────────────────────────┘
```

Invariants:
- **Always clickable** → drill-down to source records
- **Always shows confidence** when derived or projected
- **Always shows data freshness**
- **Colors on favorability, never direction** (§2.6)
- **Absent, never zero**, when we can't compute it honestly — replaced by a stub explaining what to
  connect

### 5.2 Answer block

Renders the answer contract ([PRD §5.1](../01-product/prd.md#51-ai-cfo-chat)). Fixed slot order:
headline (serif, `body-lg`) → figures (inline chips, clickable) → why (serif) → assumptions
(collapsible, editable) → confidence → recommended action (a real button) → "show the work"
(collapsed).

The visual weight ordering is deliberate: the answer is heaviest, the evidence is lightest. A user
in a hurry reads one sentence and stops, and that sentence is correct on its own.

### 5.3 Chart card

Title, optional period control, the plot, direct labels, legend when ≥2 series, and a "view as
table" toggle in the corner. The table toggle is not an accessibility afterthought — financial users
genuinely want the numbers, and it satisfies the light-mode contrast relief requirement from §2.5.

### 5.4 Alert card

Severity glyph + label (never color alone) · headline · figures · why · ranked actions with estimated
impact · dismiss-with-reason. Critical alerts get a left border rule in `--status-critical`, not a
filled red background — a full red card induces panic, which is not the response we want from someone
who has three weeks to fix a cash gap.

### 5.5 Other components

Buttons (primary/secondary/ghost/destructive, 32/40px), inputs with inline validation, tables
(sticky header, sortable, right-aligned tabular numerals, row drill-down), tabs, dialogs, popovers,
toasts, skeletons, and empty states.

**Empty states carry real weight here** — "no data yet" is common during onboarding and after a
connection breaks. Each states what's missing, why it matters, and the one action that fixes it.

### 5.6 Data freshness indicator

Persistent in the top bar. Three states, and it is never hidden:

| State | Appearance |
|---|---|
| Fresh | Small dot, `--status-positive`, "Updated 6:00am" |
| Stale | `--status-caution`, "Bank data from yesterday" |
| Broken | `--status-serious`, "Reconnect Chase" + two-click action |

---

## 6. Data visualization rules

**Form follows the data's job**, and sometimes the answer is not a chart — a single figure with a
sentence beats a chart of one number.

**Marks:** 2px lines · ≥8px hover markers · 4px rounded data-ends anchored to the baseline · 2px
surface gap between stacked segments and adjacent bars · 2px surface ring where marks overlap.

**Grid and axes are recessive** — `--border-subtle`, no chart junk, no gradient fills under lines
except the forecast band (which encodes real information).

**Direct labels by default**, on the last point of a line and on the largest segments — never a
number on every point. This is required, not optional, for any light-mode chart using slots 5–6
(§2.5).

**Legend present for ≥2 series; none for one** — the title names a single series.

**Text wears text tokens, never the series color.** A colored mark sits beside the label; the label
itself stays in `--text-secondary`.

**Hover layer by default:** crosshair + tooltip on line/area, per-mark tooltip on bar/dot. Hit
targets larger than the marks.

**Never a dual-axis chart.** Two measures of different scale become two charts, small multiples, or
both indexed to a common base. This is the most common chart mistake in financial software and we
will be tempted by it constantly — revenue and margin on one plot, cash and burn on one plot. The
answer is always two plots.

### 6.1 The forecast chart — the signature visual

The one chart the brand is recognized by, and worth disproportionate craft.

```
  cash
   │                                        ╱⎺⎺⎺⎺⎺  ← P90
   │      actual (solid, teal, 2px)    ╱▒▒▒▒▒▒▒▒▒
   │   ────────────────────────●╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌  ← P50 (dashed past today)
   │                           │      ╲▒▒▒▒▒▒▒▒▒
   │                           │           ╲____  ← P10
   │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│┄┄┄┄┄┄◆┄┄┄┄┄┄┄┄┄  ← payroll floor (dashed rule)
   │                         today      ▲
   └──────────────────────────────────────────────
                                    risk event marker
```

Rules specific to it:
- **Solid before today, dashed after.** The actual/projected boundary must be unmissable — this is
  the difference between a fact and a forecast, and blurring it is dishonest.
- **The band is the point.** P10–P90 as a filled region at ~12% opacity. A single forecast line
  implies certainty we don't have.
- **Risk events are marked objects on the timeline**, not just a dip in the curve. Each is hoverable
  and clickable into the flow that resolves it.
- **Reference rules** for the payroll floor and zero, so "will I make payroll?" is answered
  *geometrically* — the user sees the answer before reading a number.

---

## 7. Motion

Fast and functional. `120ms` micro-interactions, `200ms` transitions, `300ms` page-level, all on
`cubic-bezier(0.2, 0, 0, 1)`.

**Streaming AI answers are the one place motion carries meaning:** staged progress
("Understanding" → "Pulling your numbers" → "Analyzing") with real state changes. Never a fake
progress bar — the stages are genuinely informative and, per
[user-flows §2](../01-product/user-flows.md#flow-2--ask-a-question-the-core-loop), they cut perceived
latency.

No decorative animation. No shimmer on financial figures. `prefers-reduced-motion` removes all
non-essential motion.

---

## 8. Accessibility

**WCAG 2.2 AA is the floor, and it's a product requirement, not a compliance one** — a meaningful
share of this audience is over 50 and reading dense numeric content.

- Text contrast ≥4.5:1; UI and marks ≥3:1 — verified in §2.5
- **Never color alone.** Status ships with icon + label. Series ship with legend + direct labels.
- Full keyboard navigation; visible focus rings; skip links; logical tab order
- Charts have accessible names, summaries, and a table equivalent
- Streaming answers announce via `aria-live="polite"` — not `assertive`, which would interrupt a
  screen reader mid-sentence on every token
- Tested with VoiceOver and NVDA on the critical flows, not just linted with axe

---

## 9. Implementation

Tailwind config generated from these tokens; the token file is the source of truth and Tailwind
consumes it. Components live in `packages/ui`, built on Radix primitives, documented in Storybook
with light/dark and RTL variants.

**Design tokens are code.** Changing a hex means editing the token file and re-running the palette
validator in CI. A palette change that fails the validator fails the build — which is the only way
these guarantees survive contact with a year of shipping.
