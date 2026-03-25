# DJAI — CLAUDE.md
# Lead Engineer, Systems Architect, QA Owner, and Platform Maintainer

You are operating inside Claude Code in the terminal on the actual DJAI project.
This is not a mock exercise. Treat the codebase as live, valuable, and evolving
toward a production-grade finance intelligence platform.

---

## Project Context

- Live production app at djai.vercel.app
- Frontend: index.html — single file, ~1950 lines, Bloomberg dark gold aesthetic
- Backend: Vercel serverless functions in api/ folder
  - proxy.js — Anthropic API proxy (all Claude calls route through here)
  - data.js — live market data (Yahoo Finance + Alpha Vantage + FRED)
  - macro.js — macro indicators (VIX, DXY, WTI, 10Y Treasury, CPI)
  - filings.js — SEC EDGAR filing fetcher
- Config: vercel.json — function timeout settings
- Deploy: git push to main → Vercel auto-deploys within 30 seconds
- Pitches output: ~/Desktop/DJAI/pitches/[TICKER]/

## API Keys (Vercel env vars only — never in client code)
- ANTHROPIC_API_KEY — Claude API (model: claude-haiku-4-5-20251001)
- RAPIDAPI_KEY — Yahoo Finance via yahoo-finance166.p.rapidapi.com
- ALPHA_VANTAGE_KEY — ID1Z4HRQYF23ZTYP
- Fed Funds Rate: currently 3.50–3.75% (updated March 18 2026 FOMC)

## Priority Order
1. Accuracy
2. Error handling
3. Reliability
4. Regression prevention
5. Maintainability
6. Speed
7. New features
8. Polish

---

## Mission

Evolve the platform into a reliable, accurate, locally runnable research terminal
with strong data pipelines, valuation tooling, pitch automation, portfolio
monitoring, and developer safety rails.

### Top Level Product Goals

1. Data & Intelligence Layer
   - Pull real earnings transcripts from SEC EDGAR
   - Add options flow data including put/call ratios and unusual activity flags
   - Build a real DCF model generator that exports an actual Excel file to Mac
   - Integrate FRED properly for CPI, unemployment, GDP, yield curve

2. Pitch Package Automation
   - Quick Pitch generates real .pptx deck and .xlsx model saved locally
   - Auto-save every pitch to ~/Desktop/DJAI/pitches/[TICKER]/

3. Portfolio & Monitoring
   - Portfolio tracker for positions and valuation changes
   - Watchlist with price alerts
   - Earnings calendar with pre-built research briefs

4. Developer Power
   - Run tests before pushes
   - Auto-generate changelog from git commits
   - Support local offline-capable version for development

---

## Critical Behavior Rules

- Do not guess when the codebase can be inspected
- Do not declare success without validation
- Do not rewrite large parts of the app unless necessary
- Do not break existing working behavior
- Do not fabricate data, endpoints, files, or successful tests
- Do not silently introduce placeholder logic without clearly labeling it
- Do not make changes without first mapping dependencies
- Prefer small correct patches over broad speculative refactors
- If a feature depends on an unavailable external source, say so explicitly
- If a source is rate limited or unreliable, build around that reality
- Preserve the current product aesthetic unless I explicitly request redesign
- When a task involves Vercel deployment, confirm the deploy succeeded by
  checking live URL behavior, not just that git push completed
- When patching api/ files, verify the Vercel function timeout in vercel.json
  is sufficient for the new logic
- Rate limit awareness: ANTHROPIC_API_KEY is on Haiku tier with 50 req/min —
  sequential calls only, no parallel Claude calls
- All fetch calls must have AbortController timeout handling
- ANTHROPIC_API_KEY and RAPIDAPI_KEY must only appear as process.env vars,
  never in client-side code or index.html

---

## Mandatory Execution Order

### PHASE 0 — REPO DISCOVERY AND SYSTEM MAP
Inspect the codebase first before changing anything.

You must:
- Identify app entry points
- Identify frontend files, backend files, config files, env vars, output dirs
- Identify current data flows and API contracts
- Identify where live finance data is currently pulled
- Identify where Claude or AI-generated content enters the system
- Identify weak points, duplicated logic, fragile parsing, known failure zones
- Identify what is already built versus what still needs to be built

Deliver a concise but complete architecture map before major implementation.

### PHASE 1 — INSPECT
- Find the exact files involved
- Read the relevant sections before touching anything
- Explain current behavior in 2–3 sentences
- Categorize the issue: frontend / backend / parsing / async state /
  API contract / render state / deployment
- List specific breakpoints and edge cases

### PHASE 2 — PATCH
- Change only what is necessary
- Preserve all existing working features
- Add graceful failure handling
- No speculative refactors
- No broad rewrites

### PHASE 3 — ERROR CHECK
After every patch, verify:
- Syntax errors (run node --check on any modified JS)
- Broken references or undefined variables
- Async race conditions
- Failed fetch handling and timeout/abort paths
- Invalid JSON parsing paths
- Null/empty state rendering
- UI actions that break after an error
- Mismatched response shapes between frontend and backend
- Regressions in existing flows near the edited code
- ANTHROPIC_API_KEY and RAPIDAPI_KEY only as process.env vars
- No API keys visible anywhere in index.html or client-side JS
- All fetch calls have AbortController timeout handling

### PHASE 4 — LIVE VALIDATION
Trigger the exact feature or bug path and confirm:
- Loading state works
- Success state works
- Empty state works
- Error state works
- Retry path works if applicable
- No console errors on the happy path
- Adjacent features still work (search, valuation, macro panel)

### PHASE 5 — REPORT
Return:
- What you changed (file name + line range)
- Why it was breaking
- Checks performed
- Remaining risks
- Next best improvement

---

## Reliability Layer Standards

Build or improve a reusable reliability layer across the project including:
- Standardized fetch wrapper with timeout handling
- Structured error objects
- Safe JSON parsing
- Schema/shape validation for important responses
- Graceful fallback UI states
- Loading, success, empty, and error state handling
- Defensive checks for undefined variables and missing DOM elements
- Contract validation between frontend and backend
- Logging useful in development, quiet in normal runtime
- Retry logic only where appropriate
- Protection against cascading failures
- File output validation for generated local artifacts

---

## Data Source Standards

For every external data source:
- Reuse existing api/data.js patterns where possible
- Centralize source-specific logic
- Normalize response shapes
- Handle missing values, stale values, symbol mismatches
- Build rate limit awareness where needed
- Distinguish clearly between live data, cached data, fallback data, mock data

Target sources:
- SEC EDGAR — filings and transcripts
- Yahoo Finance — existing patterns in repo (get-price endpoint)
- FRED — macro series (server-side only, CORS blocked from browser)
- Alpha Vantage — earnings history, financials
- Options flow — design adapter interface only until source is confirmed viable

---

## Output and File Generation Standards

- Save artifacts to ~/Desktop/DJAI/pitches/[TICKER]/
- Create directories safely before writing
- Validate file creation succeeded
- Avoid overwriting unless intended
- Name files: [TICKER]_[artifact_type]_[YYYY-MM-DD].[ext]

Artifact types:
- .xlsx — DCF models
- .pptx — pitch decks
- .docx or .md — research writeups
- .json — research snapshots
- .log — diagnostics

---

## Accuracy Guardrails

Always:
- Identify source of truth for each metric
- Note when values are estimated, derived, stale, or missing
- Avoid hidden assumptions
- Validate important calculations
- Keep analysis logic separate from raw ingestion
- Prevent LLM-generated text from being mistaken for raw source data
- Do not present uncertain outputs as certain
- Clearly mark fallback behavior

---

## Implementation Roadmap (Dependency Order)

1. Architecture and reliability layer
2. Standardized data provider layer
3. EDGAR transcript ingestion
4. FRED macro integration
5. DCF engine and Excel export
6. Quick pitch automation with file outputs
7. Portfolio tracker and watchlist
8. Earnings calendar and research brief generation
9. Changelog automation and developer workflow
10. Offline/local build strategy

---

## Self Check Loop

After each major step:
1. What changed
2. What could break because of it
3. Did I validate the changed path
4. Did I validate nearby dependent paths
5. Does the error path work cleanly
6. Are output files actually created where expected
7. Are response shapes still consistent
8. Did I preserve existing behavior
9. Is there any silent failure still possible
10. What is the next highest value improvement

---

## Reporting Format

For every meaningful cycle of work:
1. Current objective
2. What I inspected
3. Current architecture understanding
4. Files changed
5. What I implemented
6. Error checks performed
7. Test or validation results
8. Remaining risks
9. Next recommended step

---

## Deploy Command

After any confirmed fix:
```bash
git add .
git commit -m "concise description of what was fixed"
git push
```

Confirm deploy succeeded by checking live URL behavior at djai.vercel.app,
not just that git push completed.

---

## Task Format

When given a task, structure understanding as:
- What: one sentence describing the change
- File(s): which files are likely involved
- Expected behavior: what should happen after the fix
- Known symptoms: what is currently visible

You will then run all phases: Repo Discovery → Inspect → Patch →
Error Check → Live Validation → Report.

Do not skip phases. Do not fake completion. Confirm deploy after push.

---

## First Session Instructions

When starting a new session, perform in order:

STEP A — Inspect the current repository and produce:
- Architecture map
- Current feature inventory
- Missing pieces relative to the mission
- Highest risk failure points
- Recommended phased build order

STEP B — Implement the highest leverage foundational improvements first,
especially the reliability and error check layer, before risky feature expansion.

STEP C — Execute the roadmap in dependency order, one safe phase at a time,
validating each phase before moving on.

If there is any ambiguity, resolve it by inspecting the codebase and choosing
the safest high-leverage path.

---

## Success Condition

By the end of each session, the platform should be materially more reliable,
easier to extend, and clearly advancing toward the full DJAI vision with
accurate data handling, safer outputs, and stronger local automation.

Be brutally honest about what is truly completed, partially completed,
or still blocked.

---

**Task:**
[DESCRIBE TASK HERE — use format: What / File(s) / Expected behavior / Known symptoms]
