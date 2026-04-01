You are running a full-stack data integrity and display audit on DJAI. This is not a cosmetic pass. Every bug described below is systemic and must be fixed across ALL tickers, ALL panels, and ALL data surfaces.

DO NOT fix these for Apple only. Fix the underlying functions, formatters, data pipelines, and contracts.

Use subagents for parallel investigation where it helps. Use the financial-modeler agent to validate DCF math. Use the reviewer agent to QC your fixes before committing.

=== PHASE 1: DIAGNOSE BY READING CODE ===

Read these files carefully before making any changes:

1. The main index.html — find ALL number formatting functions. Search for functions that convert raw numbers to display strings (e.g., adding B, M, T suffixes, formatting currency, formatting percentages, formatting multiples).

2. The valuation panel code — find the DCF model logic. Trace how WACC, terminal growth, revenue projections, EBITDA, FCF, discount factors, and implied price are calculated. Trace where currentPrice is sourced from and why it might show "$—" (blank/undefined).

3. api/data.js — trace how FMP data flows from the API response to the frontend. Check the normalization: are raw FMP numbers (which come as integers like 410275000000) being correctly scaled before display?

4. api/macro.js — trace the FRED API calls. Check series IDs for Fed Funds (DFEDTARU, DFEDTARL) and CPI (CPIAUCSL). Check if the API key is present and if the response parsing handles the FRED JSON format correctly.

5. The pitch prompt template — check what financial data is injected into Claude's prompt. If the prompt sends raw unformatted numbers, Claude will generate analysis based on wrong values.

=== PHASE 2: FIX THE ROOT CAUSES ===

BUG 1 — Number formatting double-count
SYMPTOM: Revenue shows as "$410275000000.0B" instead of "$410.3B"
ROOT CAUSE: The formatter is appending "B" to an already-large number without dividing by 1e9 first. OR the FMP response returns numbers in raw form and the formatter assumes they're already scaled.
FIX: Find the shared number formatting function. It must:
  - Take a raw number (e.g., 410275000000)
  - Divide appropriately: >= 1e12 → divide by 1e12, suffix T; >= 1e9 → divide by 1e9, suffix B; >= 1e6 → divide by 1e6, suffix M
  - Format to 1 decimal place: $410.3B
  - Handle negatives in parentheses: ($12.4B)
  - Handle null/undefined → "—"
  - This function must be used EVERYWHERE numbers are displayed, not just in one panel.

BUG 2 — Current price not reaching valuation panel
SYMPTOM: Valuation panel shows "$—" for current price. Overview panel shows $253.60 correctly.
ROOT CAUSE: The valuation panel is reading currentPrice from a different data path than the overview panel. Likely the quote data isn't being passed to or stored where the valuation code expects it.
FIX: Trace where the overview gets its price (probably from the FMP quote response). Then trace where the valuation panel reads currentPrice. Make them use the same source. If the valuation panel reads from the AI-generated JSON response and Claude didn't include currentPrice, inject it from the quote data directly.

BUG 3 — DCF model producing wrong implied price
SYMPTOM: Apple implied price is $123.75. This is roughly half of fair value. The WACC is 7.0% (too low for Apple, should be ~9-10%).
ROOT CAUSE CANDIDATES:
  a) WACC default is wrong or not being sourced from FMP's WACC endpoint
  b) Revenue/EBITDA inputs are in wrong units (raw vs billions), causing the entire FCF projection to be off
  c) Shares outstanding might be wrong (using a raw number that's too large, diluting the per-share value)
  d) Net debt might have a sign error or unit mismatch
  e) Terminal value calculation might have an error
FIX: 
  - Check if FMP returns a WACC value. If so, use it. If not, calculate from beta, risk-free rate, equity risk premium, and debt cost.
  - Verify that revenue inputs to the DCF are in the SAME units as the divisor. If revenue comes in as 410275000000 and shares come in as 15550000000, the math might work. But if revenue is displayed as 410275000000.0B (already formatted), the calculation is using a string or double-scaled value.
  - Verify shares outstanding is the diluted count, not basic.
  - Verify net debt sign convention (positive = has debt, negative = net cash).
  - After fixing, verify: implied price for Apple should be roughly $180-$300 depending on assumptions. If it's $123, something is still wrong.

BUG 4 — Macro indicators returning null
SYMPTOM: Fed Funds and CPI show dashes on the homepage.
ROOT CAUSE: api/macro.js FRED API calls are failing silently.
FIX:
  - Check if FRED_API_KEY exists in env vars. If not, the macro endpoint needs to use a free FRED alternative or show "API key missing" instead of a silent dash.
  - FRED API format: https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&api_key=KEY&limit=1&sort_order=desc&file_type=json
  - Check if the response parsing correctly extracts the value from FRED's JSON structure: response.observations[0].value
  - If FRED requires its own API key and you don't have one, use FMP's economic data endpoints instead (e.g., /v4/treasury or /v3/market-risk-premium) or hardcode the current Fed Funds rate (4.25-4.50% as of March 2026) as a fallback with an "as of" label.
  - For CPI: FRED series CPIAUCSL. Same parsing logic.
  - Every macro tile must show either a real value with source/timestamp OR "Unavailable" with the reason. Never a silent dash.

BUG 5 — Pitch prompt sending malformed data to Claude
SYMPTOM: The AI-generated analysis references numbers that may be based on unformatted raw integers.
FIX: Before injecting financial data into the Claude prompt, ensure all numbers are human-readable. The prompt should say "Revenue: $410.3B" not "Revenue: 410275000000". Check the prompt template and the data injection point. Format all numbers before they enter the prompt.

=== PHASE 3: CROSS-TICKER VERIFICATION ===

After all fixes, test with these tickers (they cover different market cap sizes and sectors):

1. AAPL — mega cap tech, ~$3.7T market cap
   - Price should match Google Finance within $1
   - P/E should be ~28-32
   - DCF implied price should be in the $180-$300 range
   - Revenue should display as ~$391B-$420B (not as a 12-digit number)

2. JPM — mega cap financials
   - P/E should be ~12-15 (banks trade at lower multiples)
   - Market cap ~$600B-$700B range

3. TSLA — high-growth, volatile
   - Higher P/E (~60-100+)
   - Market cap ~$800B-$1.2T range

4. A small/mid cap ticker (try FTLF or similar) — verify it doesn't break on smaller numbers

For each: verify price, market cap, P/E, revenue formatting, DCF assumptions, and implied price are reasonable.

=== PHASE 4: MACRO VERIFICATION ===

Verify all macro tiles show real values:
- Fed Funds Rate: should be 4.25-4.50% (or the current target range)
- 10Y Treasury: should be ~4.2-4.6%
- CPI (YoY): should be ~2.5-3.5%
- VIX: should be a number (typically 12-35)
- DXY: should be ~99-106
- WTI Crude: should be ~$65-$105

If any macro tile still shows a dash after fixes, explain why and what would be needed to fix it.

=== PHASE 5: COMMIT AND VERIFY ===

1. Run the full verification suite: python syntax check, secret scan, console log audit
2. Commit with message: "fix: systemic data formatting, DCF pipeline, macro indicators, price pass-through"
3. Push to main
4. Report what changed, what files were touched, and what risks remain

=== ANTI-PATTERNS ===

DO NOT:
- Fix formatting only in one function and leave other formatting functions broken
- Hardcode Apple-specific values anywhere
- Silence errors with empty catch blocks
- Leave any panel showing "$—" or "NaN" or "$410275000000.0B" on production
- Skip the cross-ticker verification
