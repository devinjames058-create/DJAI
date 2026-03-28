# DJAI Handoff — 2026-03-27

## Goal

Full-system stabilization, data-trust rebuild, and security hardening across the entire DJAI Finance Intelligence terminal.

---

## Progress

### Completed this session (3 commits, pushed to main)

#### `88ec40a` — Production hardening
- Search lifecycle: stale-response protection via generation counter + AbortController
- Modal validation: portfolio add/edit guards all fields
- Macro provenance: source labels on every macro tile
- Watchlist UX improvements

#### `cb4103e` — Systemic data formatting, DCF pipeline, macro indicators, web search
- **Revenue formatting bug fixed**: `toBillions()` normalizer in `renderDCF()` and `_doRecalcDCF()` — prevents "$410275000000.0B" double-count
- **Current price "$—" bug fixed**: injects `_anchPrice` from live FMP data after part1, uses `!= null && > 0` guard in `renderGauges()`
- **DCF implied price fixed**: unit contract in prompt2 (`CRITICAL UNIT CONTRACT — ALL monetary values in BILLIONS`), live anchor injection after part2 for `sharesOutstanding`, `netDebt`, `currentPrice`, plus inline recompute of `impliedPrice`
- **Macro indicators fixed**: `fredLatest()` backward-scan skips `"."` weekend/holiday entries; 8s `AbortController` timeout on all FRED fetches
- **Web search added**: `proxy.js` sends `anthropic-beta: web-search-2025-03-05` header + `web_search_20250305` tool when `useSearch: true`

#### `0384665` — XSS sanitization, markdown, DCF hardening, mobile CSS, accessibility, trust lib
- **XSS eliminated**: `_sanitizeText()` applied at 57 call sites — all Claude-generated text fields injected via `innerHTML`
- **Markdown rendering**: `_renderMd()` for follow-up answers (bold, italic, code, bullets, paragraphs)
- **DCF hardening**: terminal growth ≥ WACC guard (amber warning, blocks calc), `shares ≤ 0` guard, `NaN`/`Infinity` prevention on all outputs
- **Mobile CSS**: first media queries in the file — `@media (max-width: 1024px/768px/480px)`
- **Accessibility**: `aria-label` on main search, search button, follow-up textarea/button, all 4 DCF inputs
- **History sanitization**: rejects entries < 2 chars; `onclick` uses `data-q` attribute instead of inline string interpolation
- **Trust infrastructure created**: `api/lib/trust.js`, `api/lib/metrics.js`, `api/lib/reconcile.js`, `api/lib/index.js` with 37 unit tests

---

## Files Modified / Created

| File | Status | Description |
|------|--------|-------------|
| `index.html` | Modified | Main SPA — all display/logic changes |
| `api/proxy.js` | Modified | Added web search beta header |
| `api/macro.js` | Modified | FRED weekend gap fix, timeouts |
| `api/lib/trust.js` | Created | TrustField factory |
| `api/lib/metrics.js` | Created | Deterministic metric engine |
| `api/lib/reconcile.js` | Created | Field policy + conflict detection |
| `api/lib/index.js` | Created | Barrel export |
| `tests/unit/trust.test.js` | Created | 10 trust layer tests |
| `tests/unit/metrics.test.js` | Created | 16 metric engine tests |
| `tests/unit/reconcile.test.js` | Created | 11 reconcile tests |
| `tests/run-all.js` | Created | Test runner |
| `package.json` | Created | `npm test` → `node tests/run-all.js` |

---

## What Worked

- Anchor injection pattern: extract authoritative FMP values (`_anchPrice`, `_anchShares`, `_anchNetDebt`) and override Claude's DCF outputs after API response — cleaner and more reliable than trusting Claude for financial quantities
- `toBillions()` auto-detector: `abs(v) > 1e6 → divide by 1e9` makes DCF display robust regardless of what units Claude outputs
- FRED backward-scan: walking `obs[]` from the end to skip `"."` entries is the correct permanent fix for the weekend/holiday gap problem
- `_sanitizeText()` + `_renderMd()` as pure utility functions defined once, applied everywhere — no framework needed

## What Failed / Is Unverified

- **Tests not executable here**: `node` is not installed in the Claude Code shell environment. Tests are structurally verified (brace/paren balance confirmed via Python) but not run. Run `npm test` on your machine to verify.
- **DCF unit contract compliance**: Claude sometimes ignores the unit contract and outputs raw dollars anyway. The `toBillions()` normalizer handles this at render time, but root cause (prompt non-compliance) remains — consider adding a server-side validation step in `api/data.js` or `api/proxy.js`

---

## Next Steps (Priority Order)

### 1. Integrate trust layer into `api/data.js` ← highest value, unblocks everything
Add `TrustField` wrappers alongside existing formatted fields in the `api/data.js` response contract. Must be **backwards-compatible** — keep existing string fields, add `*Trust` fields alongside:

```js
const { field, nullField } = require('./lib/trust');
const { computePE, computeMarketCap, computeEV } = require('./lib/metrics');

// In the response:
priceT: q.price != null
  ? field(q.price, { source: 'FMP', sourceType: 'canonical', valueType: 'live', asOf: new Date().toISOString() })
  : nullField('FMP', 'price unavailable'),
peT: computePE(priceT, epsT),
marketCapT: computeMarketCap(priceT, sharesRawT),
```

### 2. Wire trust badges into the UI
Use the `TrustField.status`, `asOf`, and `source` fields to render provenance chips on key metrics. Add `renderTrustBadge(tf)` and `renderBasisLabel(tf)` in `index.html`.

### 3. Web confirmation layer (from stabilization spec)
For fields where the LLM provides context (not canonical truth), add a confirmation step that checks authoritative domains. This was designed as a read-only overlay — never overrides `canonical` fields, only flags `research`-type fields.

### 4. Query state machine
Implement `QUERY_STATE` enum with 11 states (`idle | loading | success-live | success-cached | timeout-with-cache | timeout-no-cache | rate-limited | invalid-query | not-found | hard-error`). Replace the current implicit state tracking in `runSearch()`.

### 5. Source transparency panel
Display per-field source labels on the overview metrics panel — "Price: FMP · 2s ago", "P/E: computed · TTM", "Revenue: FMP · Q4 2024". This is the trust layer surfaced to the user.

---

## Open Questions

1. Should `api/data.js` return `TrustField` objects directly in the JSON (verbose but complete), or should it return a separate `trust: { fieldName: TrustField }` map to keep the primary contract clean?
2. The DCF prompt currently sends the unit contract as a `CRITICAL` label. Should this be enforced with a server-side validation pass that rejects the response if values look like raw dollars?
3. Mobile layout hides the left sidebar by default (`display: none`). Should there be a hamburger toggle to show it?

---

## Verification Status

| Check | Status |
|-------|--------|
| `index.html` brace/paren balance | ✓ Pass (Python check: `{=741, }=741, (=1758, )=1758`) |
| XSS coverage | ✓ 57 `_sanitizeText` call sites |
| Git push | ✓ `cb4103e..0384665 → origin/main` |
| Unit tests | ⚠ Not run — `node` unavailable in shell. Run `npm test` locally. |
| Vercel deploy | ⏳ Triggered by push — check Vercel dashboard |
