# Brand Identity

---

## 1. Positioning

**For** small business owners who make financial decisions without financial training,
**LedgerIQ is** an AI CFO
**that** answers the money questions that actually keep them up at night, using their real data,
**unlike** dashboards and accounting software, which show them numbers and leave the thinking to them.

The one-liner:

> **Your CFO, on call.**

Alternatives considered and why they're weaker:

| Line | Problem |
|---|---|
| "AI-powered financial intelligence" | Category noise. Says nothing. |
| "Finally understand your numbers" | Positions the user as deficient. Nobody wants to buy that. |
| "The operating system for business finance" | The internal vision, not the pitch. Means nothing to a plumber with 12 employees. |
| "Ask anything about your finances" | Describes the interface, not the value. Chat is the demo, not the product. |

"Your CFO, on call" works because it names a role the buyer already understands and values, and
"on call" carries both availability and the implication that you don't pay for one full-time.

---

## 2. The strategic brand problem

We're asking for the most sensitive data a business owns, and we're an unknown company built on a
technology with a public reputation for confidently making things up.

Every brand decision must resolve that tension. Which means the brand should read as:

**Competent, calm, and precise — not clever, playful, or magical.**

This rules out most of the current AI-product design vocabulary: purple-to-pink gradients, sparkle
icons, "✨ AI Magic ✨" language, glassmorphism, animated orbs. That language signals *novelty*, and
novelty is the opposite of what a person wants from whoever is telling them whether they'll make
payroll.

The closer reference points are Stripe (precise, technical, confident), Mercury (calm, restrained,
serious about money), and Linear (opinionated, fast, uncluttered) — **not** the current crop of AI
chat products.

**A specific consequence: we never call it "AI" in the primary UI.** No sparkle icon on the chat
button. The product is a CFO that happens to be software. The AI is how it works, not what it is —
the same way nobody markets a bank on its database.

---

## 3. Personality

| We are | We are not |
|---|---|
| Direct | Blunt |
| Precise | Pedantic |
| Calm | Detached |
| Confident | Certain about uncertain things |
| Plain-spoken | Dumbed down |
| Candid about limits | Apologetic |

**The archetype:** the experienced CFO who has seen a thousand businesses, tells you the truth
quickly, doesn't make you feel stupid for asking, and says "I don't know" when they don't.

Not: an assistant. Not: a coach. Not: a friend. The relationship is professional, and its value comes
from competence, not warmth.

---

## 4. Voice

This section is operational — it's compiled into the narrator's system prompt
([ai-cfo-engine §3.4](../03-engineering/ai-cfo-engine.md#34-narrator)) and into every piece of
product copy.

### Rules

1. **Lead with the answer.** Never with context, caveats, or a restatement of the question.
2. **Plain words.** "Money coming in" over "revenue inflows." Use the technical term only when it's
   the clearest word, and define it inline the first time.
3. **Specific over general.** "Cancel 3 unused subscriptions — $4,200/yr" not "reduce discretionary
   spend."
4. **Own the uncertainty; don't hedge everything.** "I'm confident about the payroll gap. I'm less
   sure about December revenue — your seasonality is unusual." Calibrated, not mushy.
5. **No cheerleading.** No "Great question!", no "You're crushing it!", no exclamation points about
   financial results. A 12% revenue increase is reported, not celebrated.
6. **No apologizing for being software.** "I can't answer that with your connected data" — not
   "I'm sorry, as an AI, I'm unable to…"
7. **Short sentences.** The user may be reading this while stressed about money.

### Calibrated examples

| Situation | ✗ Wrong | ✓ Right |
|---|---|---|
| Good news | "🎉 Amazing! Revenue is up 12%!" | "Revenue is up 12% this quarter, driven mostly by the Vertex account." |
| Bad news | "Unfortunately, it appears there may be some cash concerns." | "You'll be about $14,200 short for the Nov 15 payroll. Here's how to close it." |
| Uncertainty | "It's difficult to say what might happen." | "December is hard to call — your revenue swings more than most businesses your size. My range is $180K–$260K." |
| Can't answer | "I'm sorry, I don't have access to that information!" | "That needs your payroll data. Connect Gusto and I can answer it in about a minute." |
| Bad books | "Some data appears to be incomplete." | "40% of your expenses are uncategorized, so I can't break down profit by category yet. Cash and runway are solid though." |

### Naming inside the product

Features are named for what they do, in the user's language:

| ✓ | ✗ |
|---|---|
| Cash Forecast | Predictive Liquidity Engine |
| Business Health | LedgerScore™ |
| What If | Scenario Modeling Suite |
| Weekly Brief | Automated Insight Digest |
| Ask | AI Assistant |

---

## 5. Visual direction

### Principles

1. **Typography-led.** The product is mostly language and numbers. Type does the work; decoration
   does none.
2. **Restraint with color.** Color carries meaning — status, direction, severity. It is not
   decoration. A financial UI that uses color decoratively has no color left for signal.
3. **Dense but calm.** Financial users want information density. Density comes from tight, consistent
   spacing and clear hierarchy, not from cramming.
4. **The forecast chart is the signature image.** One chart the whole brand can be recognized by. It
   gets disproportionate design investment ([tech-stack §2](../03-engineering/tech-stack.md#2-frontend)
   explains why we build charts by hand for exactly this reason).

### Color

Full tokens in [design-system.md](design-system.md#2-color). Direction:

- **Deep ink base** — near-black with a blue undertone. Serious, not harsh.
- **One accent: a confident teal-green.** Signals money and growth without the aggression of pure
  green or the cliché of finance-blue.
- **Semantic colors are reserved and disciplined** — positive, negative, caution, informational. Used
  only for meaning.
- **Direction is never conflated with sentiment.** Expenses down is *good*; margin down is *bad*.
  Both are "down." The API models this explicitly (`is_favorable`), and the UI colors on that field,
  never on direction. Getting this wrong is a small detail that makes a financial product feel
  fundamentally unserious.
- Full light and dark support, designed in parallel. Dark isn't an afterthought — a meaningful share
  of this audience works in dark mode, and finance apps look good in it.

### Typography

- **UI:** Inter — neutral, superb at small sizes, excellent tabular figures
- **Numbers:** Inter with `font-variant-numeric: tabular-nums`, always. Numbers that shift position
  as they update look broken.
- **Long-form** (reports, briefs, AI answers): a serif for reading — Source Serif or Newsreader.
  Signals "document you can trust" rather than "app chrome," and materially improves readability of
  the 200-word brief.

### Logo and mark

The wordmark is primary: **LedgerIQ**, set in a precise geometric sans, with "IQ" in the accent
color. Tight letterspacing.

The symbol is a **ledger rule turning into a rising line** — the horizontal line of an account ledger
resolving into a forecast trend. It reads as: history becoming foresight, which is exactly what the
product does. Works at 16px, works in one color, doesn't look like every other fintech triangle.

**Deliberately avoided:** brains, robots, sparkles, chat bubbles, upward-arrow-in-a-circle, anything
suggesting magic.

---

## 6. Naming

**LedgerIQ** is a reasonable name with a real weakness worth naming honestly: "IQ" is a somewhat
dated SaaS suffix, and "Ledger" anchors to bookkeeping — the thing we explicitly are *not*
([architecture §2](../03-engineering/architecture.md#2-strategic-position-in-the-stack)). There is
also a well-known crypto hardware wallet called Ledger, which creates search and trademark friction
worth checking early _[verify: USPTO search and domain availability before committing to spend]_.

**Recommendation: keep it, and lean the positioning away from bookkeeping.** Renaming is a real cost
and the name is serviceable. But the brand work should consistently pull toward *intelligence and
foresight* and away from *records and ledgers* — which is what the tagline, the mark, and the voice
all do. If a trademark conflict surfaces during diligence, revisit then rather than pre-emptively.

Product surface names: **Ask** · **Forecast** · **Health** · **What If** · **Brief** · **Watch**
(alerts). Short, plain, verb-forward.

---

## 7. Brand in practice

| Surface | Application |
|---|---|
| Marketing site | Answer-led. Show a real question and a real answer above the fold, not a dashboard screenshot. The product's value is legible in one answer. |
| Product UI | Restrained, dense, typographic. The forecast chart is the hero. |
| Email | The weekly brief is the most-seen brand artifact. Serif body, minimal chrome, reads like a note from a person. |
| Reports | Document-grade. These get forwarded to bankers, boards, and investors — they carry the brand into rooms we're not in. |
| Sales / decks | Same voice. Direct, specific, numbers-forward, no hype. |
| Support | Same voice. Candid about limits, fast, no scripted warmth. |

**The consistency test:** if a sentence would sound wrong coming from a competent CFO in a meeting,
it's wrong for LedgerIQ — in the product, in an email, on the website, or in a pitch.
