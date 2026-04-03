'use strict';
// ── Financials API — SEC EDGAR companyfacts with FMP fallback ─────────────────
// Primary: SEC EDGAR companyfacts (no key required)
// Fallback: FMP income/balance/cashflow endpoints (requires FMP_API_KEY)
// Supports GET ?ticker=AAPL and POST { ticker: "AAPL" }.
// Cache keys use "v5_" prefix to bust stale entries with wrong EDGAR dedup results.

const TICKER_INDEX_URL = 'https://www.sec.gov/files/company_tickers.json';
const EDGAR_FACTS_URL  = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const FMP_BASE         = 'https://financialmodelingprep.com/api/v3';
const UA               = 'DJAI Finance dev@djai.app';
const TIMEOUT          = 15000;

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

// ── In-memory caches ──────────────────────────────────────────────────────────
let   _tickerIndex = null;         // { data: normalizedTicker→{cik,name}, time }
const _factsCache  = new Map();    // paddedCik → { data, time }
const _finCache    = new Map();    // 'v5_'+ticker → { data, time }

const TICKER_TTL = 24 * 60 * 60 * 1000;
const FACTS_TTL  = 7  * 24 * 60 * 60 * 1000;
const FIN_TTL    = 24 * 60 * 60 * 1000;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function _edgarFetch(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const err = new Error(`SEC EDGAR HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function _fmpFetch(path, key, signal) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FMP_BASE}${path}${sep}apikey=${key}`, { signal });
  if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
  return res.json();
}

// ── CIK resolution ────────────────────────────────────────────────────────────

async function _resolveCIK(ticker) {
  const now = Date.now();
  if (!_tickerIndex || (now - _tickerIndex.time > TICKER_TTL)) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const raw = await _edgarFetch(TICKER_INDEX_URL, ctrl.signal);
      clearTimeout(timer);
      const lookup = {};
      for (const entry of Object.values(raw)) {
        const key = String(entry.ticker).toUpperCase().replace(/[.\-]/g, '');
        lookup[key] = {
          cik:  String(entry.cik_str || entry.cik).padStart(10, '0'),
          name: entry.title || entry.ticker,
        };
      }
      _tickerIndex = { data: lookup, time: now };
    } catch (e) {
      clearTimeout(timer);
      if (!_tickerIndex) throw e;
    }
  }
  const normalized = ticker.toUpperCase().replace(/[.\-]/g, '');
  return _tickerIndex.data[normalized] || null;
}

// ── Companyfacts fetch ────────────────────────────────────────────────────────

async function _getCompanyFacts(paddedCik) {
  const cached = _factsCache.get(paddedCik);
  if (cached && (Date.now() - cached.time < FACTS_TTL)) return cached.data;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const data = await _edgarFetch(EDGAR_FACTS_URL(paddedCik), ctrl.signal);
    clearTimeout(timer);
    _factsCache.set(paddedCik, { data, time: Date.now() });
    return data;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── Tag extraction ────────────────────────────────────────────────────────────
//
// Returns: fy (number) → { val (number), end (string|null) }
// Priority: first tag in the array that has data for a given fiscal year wins.
//
// Filters applied per entry:
//   1. Form must be in ANNUAL_FORMS (10-K / 10-K/A / 20-F / 20-F/A / 40-F/A)
//   2. Duration facts (entry.start is present) must have fp === 'FY' explicitly.
//      Instant facts (no start — balance-sheet snapshots) carry no fp; allowed.
//
// Deduplication within a tag/FY pair:
//   PRIMARY  — largest val wins  (annual $215B always beats quarterly $60B)
//   FALLBACK — latest filed date (picks most-recent amendment when vals match)
//
// Revenue tags get verbose console.log so Vercel logs can confirm annual values.

const _REV_TAGS = new Set([
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
]);

function _extractByTags(facts, tags, opts = {}) {
  const { isEps = false, isShares = false } = opts;
  const yearMap = {};

  for (const tag of tags) {
    const tagMap = {}; // fy → { val, filed, end, fp }
    const isRevTag = _REV_TAGS.has(tag);
    let dbgTotal = 0, dbgFormPass = 0, dbgFpPass = 0;

    for (const taxonomy of ['us-gaap', 'dei']) {
      const tagData = facts.facts?.[taxonomy]?.[tag];
      if (!tagData?.units) continue;

      for (const [unit, entries] of Object.entries(tagData.units)) {
        if (isEps    && unit !== 'USD/shares') continue;
        if (isShares && unit !== 'shares')     continue;
        if (!isEps && !isShares && unit !== 'USD') continue;

        for (const entry of entries) {
          if (isRevTag) dbgTotal++;

          // ── 1. Form filter: annual filings only ──────────────────────────
          if (!ANNUAL_FORMS.has(entry.form)) continue;
          if (isRevTag) dbgFormPass++;

          // ── 2. Period filter ─────────────────────────────────────────────
          // Duration facts must be explicitly marked FY to avoid
          // admitting quarterly/Q4 values into annual statement rows.
          if (entry.fp !== 'FY') continue;
          if (isRevTag) dbgFpPass++;

          // ── 3. Fiscal year derivation ────────────────────────────────────
          const fy = entry.fy != null
            ? Number(entry.fy)
            : parseInt(entry.end?.slice(0, 4), 10);
          if (!fy || isNaN(fy)) continue;

          const entryVal = Number(entry.val);
          const filed    = entry.filed || entry.end || '';

          // Verbose per-fact log for Revenue tags (shows up in Vercel fn logs)
          if (isRevTag) {
            console.log(`[EDGAR rev] PASS tag=${tag} form=${entry.form} fp=${entry.fp ?? 'null'} ` +
              `fy=${fy} val=${entryVal} end=${entry.end} filed=${entry.filed} start=${entry.start ?? 'none'}`);
          }

          // ── 4. Deduplication: largest val wins; latest filed breaks ties ─
          const cur = tagMap[fy];
          const betterVal  = !cur || entryVal > cur.val;
          const sameVal    = cur  && entryVal === cur.val;
          const betterFile = sameVal && filed > (cur.filed || '');
          if (betterVal || betterFile) {
            tagMap[fy] = { val: entryVal, filed, end: entry.end || null, fp: entry.fp || null };
          }
        }
      }
    }

    // Summary log after each Revenue tag
    if (isRevTag && dbgTotal > 0) {
      const summary = Object.entries(tagMap)
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 3)
        .map(([fy, i]) => `FY${fy}=$${(i.val / 1e9).toFixed(3)}B(fp=${i.fp ?? 'instant'})`)
        .join(', ');
      console.log(`[EDGAR] tag=${tag} raw=${dbgTotal} form=${dbgFormPass} fp=${dbgFpPass} WINNER: ${summary || 'none'}`);
    }

    // Fill years not yet covered by a higher-priority tag
    for (const [fyStr, info] of Object.entries(tagMap)) {
      const fy = Number(fyStr);
      if (yearMap[fy] == null) yearMap[fy] = { val: info.val, end: info.end };
    }
  }

  return yearMap;
}

function _selectYears(maps) {
  const fySet = new Set();
  for (const m of maps) for (const fy of Object.keys(m)) fySet.add(Number(fy));
  return Array.from(fySet).sort((a, b) => b - a).slice(0, 5);
}

function _v(map, fy) {
  const entry = map[fy];
  if (entry == null) return null;
  return (entry.val != null && isFinite(entry.val)) ? entry.val : null;
}
function _end(map, fy) { return map[fy]?.end || null; }
function _date(maps, fy) {
  for (const m of maps) { const d = _end(m, fy); if (d) return d; }
  return String(fy) + '-12-31';
}

function _buildStatements(facts, years) {
  const revenue     = _extractByTags(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet']);
  const costOfRev   = _extractByTags(facts, ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold']);
  const grossProfit = _extractByTags(facts, ['GrossProfit']);
  const rnd         = _extractByTags(facts, ['ResearchAndDevelopmentExpense']);
  const sga         = _extractByTags(facts, ['SellingGeneralAndAdministrativeExpense']);
  const opIncome    = _extractByTags(facts, ['OperatingIncomeLoss']);
  const intExp      = _extractByTags(facts, ['InterestExpenseAndOther', 'InterestExpense']);
  const netIncome   = _extractByTags(facts, ['NetIncomeLoss', 'ProfitLoss']);
  const eps         = _extractByTags(facts, ['EarningsPerShareDiluted'], { isEps: true });
  const dilShares   = _extractByTags(facts, ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'], { isShares: true });

  const cash        = _extractByTags(facts, ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments']);
  const curAssets   = _extractByTags(facts, ['AssetsCurrent']);
  const totAssets   = _extractByTags(facts, ['Assets']);
  const curLiab     = _extractByTags(facts, ['LiabilitiesCurrent']);
  const ltDebt      = _extractByTags(facts, ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations']);
  const totLiab     = _extractByTags(facts, ['Liabilities']);
  const equity      = _extractByTags(facts, ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']);
  const sharesOS    = _extractByTags(facts, ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'], { isShares: true });

  const opCF        = _extractByTags(facts, ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities']);
  const capex       = _extractByTags(facts, ['PaymentsToAcquirePropertyPlantAndEquipment']);
  const acquisitions= _extractByTags(facts, ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross', 'PaymentsToAcquireBusiness']);
  const dividends   = _extractByTags(facts, ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock']);
  const buybacks    = _extractByTags(facts, ['PaymentsForRepurchaseOfCommonStock']);
  const investCF    = _extractByTags(facts, ['NetCashProvidedByUsedInInvestingActivities']);
  const finCF       = _extractByTags(facts, ['NetCashUsedProvidedByFinancingActivities', 'NetCashProvidedByUsedInFinancingActivities']);

  const incomeStatement = years.map(fy => {
    const rev = _v(revenue, fy);
    const cor = _v(costOfRev, fy);
    let   gp  = _v(grossProfit, fy);
    if (gp == null && rev != null && cor != null) gp = rev - cor;
    return {
      date:         _date([revenue, netIncome], fy),
      calendarYear: String(fy),
      revenue:      rev,
      costOfRevenue: cor,
      grossProfit:  (gp != null && isFinite(gp)) ? gp : null,
      researchAndDevelopmentExpenses:          _v(rnd, fy),
      sellingGeneralAndAdministrativeExpenses: _v(sga, fy),
      operatingIncome: _v(opIncome, fy),
      interestExpense: _v(intExp, fy),
      netIncome:       _v(netIncome, fy),
      epsDiluted:      _v(eps, fy),
      weightedAverageShsOutDil: _v(dilShares, fy),
    };
  });

  const balanceSheet = years.map(fy => {
    const totA = _v(totAssets, fy);
    const totL = _v(totLiab, fy);
    let   eq   = _v(equity, fy);
    if (eq == null && totA != null && totL != null) eq = totA - totL;
    const eqFinal = (eq != null && isFinite(eq)) ? eq : null;
    let bvps = null;
    if (eqFinal != null) {
      const sh = _v(sharesOS, fy);
      if (sh != null && sh !== 0) bvps = eqFinal / sh;
    }
    return {
      date:                    _date([totAssets, equity], fy),
      calendarYear:            String(fy),
      cashAndCashEquivalents:  _v(cash, fy),
      totalCurrentAssets:      _v(curAssets, fy),
      totalAssets:             totA,
      totalCurrentLiabilities: _v(curLiab, fy),
      longTermDebt:            _v(ltDebt, fy),
      totalLiabilities:        totL,
      totalStockholdersEquity: eqFinal,
      bookValuePerShare:       (bvps != null && isFinite(bvps)) ? bvps : null,
    };
  });

  const cashFlow = years.map(fy => {
    const opCFv    = _v(opCF, fy);
    const capexRaw = _v(capex, fy);
    const capexv   = capexRaw != null ? -Math.abs(capexRaw) : null;
    const fcf      = (opCFv != null && capexRaw != null) ? opCFv - Math.abs(capexRaw) : null;
    const acqRaw   = _v(acquisitions, fy);
    const divRaw   = _v(dividends, fy);
    const buyRaw   = _v(buybacks, fy);
    return {
      date:                   _date([opCF, investCF], fy),
      calendarYear:           String(fy),
      operatingCashFlow:      opCFv,
      capitalExpenditure:     capexv,
      freeCashFlow:           (fcf != null && isFinite(fcf)) ? fcf : null,
      acquisitionsNet:        acqRaw != null ? -Math.abs(acqRaw) : null,
      dividendsPaid:          divRaw != null ? -Math.abs(divRaw) : null,
      commonStockRepurchased: buyRaw != null ? -Math.abs(buyRaw) : null,
      netCashProvidedByUsedInInvestingActivities: _v(investCF, fy),
      netCashUsedProvidedByFinancingActivities:   _v(finCF, fy),
    };
  });

  return { incomeStatement, balanceSheet, cashFlow };
}

// ── EDGAR attempt ─────────────────────────────────────────────────────────────
// Returns payload object or null (no data). Throws on network error.

async function _tryEdgar(ticker) {
  let entry;
  try {
    entry = await _resolveCIK(ticker);
  } catch (e) {
    throw e;
  }
  if (!entry) return null; // not in SEC EDGAR

  const { cik, name: entityName } = entry;
  const facts = await _getCompanyFacts(cik); // throws on network error

  const revenueMap = _extractByTags(facts, ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet']);
  const assetsMap  = _extractByTags(facts, ['Assets']);
  const opCFMap    = _extractByTags(facts, ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities']);

  const years = _selectYears([revenueMap, assetsMap, opCFMap]);
  if (!years.length) return null;

  const { incomeStatement, balanceSheet, cashFlow } = _buildStatements(facts, years);
  if (!incomeStatement.length && !balanceSheet.length && !cashFlow.length) return null;

  return {
    entity: entityName,
    ticker,
    cik:    cik.replace(/^0+/, ''),
    source: 'SEC EDGAR (10-K)',
    incomeStatement,
    balanceSheet,
    cashFlow,
  };
}

// ── FMP fallback ──────────────────────────────────────────────────────────────
// Returns payload object or null. Never throws — swallows all errors.

function _normFmpIS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:              r.date              ?? null,
    calendarYear:      r.calendarYear      ?? null,
    revenue:           r.revenue           ?? null,
    costOfRevenue:     r.costOfRevenue     ?? null,
    grossProfit:       r.grossProfit       ?? null,
    researchAndDevelopmentExpenses:          r.researchAndDevelopmentExpenses ?? null,
    sellingGeneralAndAdministrativeExpenses: r.sellingGeneralAndAdministrativeExpenses ?? null,
    operatingIncome:   r.operatingIncome   ?? null,
    interestExpense:   r.interestExpense   ?? null,
    netIncome:         r.netIncome         ?? null,
    epsDiluted:        r.epsDiluted        ?? null,
    weightedAverageShsOutDil: r.weightedAverageShsOutDil ?? null,
  }));
}

function _normFmpBS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:                    r.date                    ?? null,
    calendarYear:            r.calendarYear            ?? null,
    cashAndCashEquivalents:  r.cashAndCashEquivalents  ?? null,
    totalCurrentAssets:      r.totalCurrentAssets      ?? null,
    totalAssets:             r.totalAssets             ?? null,
    totalCurrentLiabilities: r.totalCurrentLiabilities ?? null,
    longTermDebt:            r.longTermDebt            ?? null,
    totalLiabilities:        r.totalLiabilities        ?? null,
    totalStockholdersEquity: r.totalStockholdersEquity ?? null,
    bookValuePerShare:       r.bookValuePerShare        ?? null,
  }));
}

function _normFmpCF(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:                   r.date                   ?? null,
    calendarYear:           r.calendarYear           ?? null,
    operatingCashFlow:      r.operatingCashFlow      ?? null,
    capitalExpenditure:     r.capitalExpenditure     ?? null,
    freeCashFlow:           r.freeCashFlow           ?? null,
    acquisitionsNet:        r.acquisitionsNet        ?? null,
    dividendsPaid:          r.dividendsPaid          ?? null,
    commonStockRepurchased: r.commonStockRepurchased ?? null,
    netCashProvidedByUsedInInvestingActivities: r.netCashProvidedByUsedInInvestingActivities ?? null,
    netCashUsedProvidedByFinancingActivities:   r.netCashUsedProvidedByFinancingActivities   ?? null,
  }));
}

async function _tryFmp(ticker) {
  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return null;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const [isRaw, bsRaw, cfRaw] = await Promise.all([
      _fmpFetch(`/income-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal),
      _fmpFetch(`/balance-sheet-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal),
      _fmpFetch(`/cash-flow-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal),
    ]);
    clearTimeout(timer);

    const incomeStatement = _normFmpIS(isRaw || []);
    const balanceSheet    = _normFmpBS(bsRaw || []);
    const cashFlow        = _normFmpCF(cfRaw || []);
    if (!incomeStatement.length && !balanceSheet.length && !cashFlow.length) return null;

    return {
      entity: (Array.isArray(isRaw) && isRaw[0]?.symbol) ? isRaw[0].symbol : ticker,
      ticker,
      source: 'FMP (SEC filings)',
      incomeStatement,
      balanceSheet,
      cashFlow,
    };
  } catch (e) {
    clearTimeout(timer);
    return null; // swallow — FMP is a fallback
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let ticker = (req.query?.ticker || '').trim().toUpperCase();
  if (!ticker && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
    ticker = (body?.ticker || '').trim().toUpperCase();
  }
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  // ── Cache check — v5_ busts entries with wrong dedup results ─────────────────
  const cacheKey = 'v5_' + ticker;
  const cached   = _finCache.get(cacheKey);
  if (cached && (Date.now() - cached.time < FIN_TTL)) {
    return res.status(200).json({ ok: true, cached: true, ...cached.data });
  }

  // ── Stage 1: Try SEC EDGAR ─────────────────────────────────────────────────
  let payload  = null;
  let lastErr  = null;

  try {
    payload = await _tryEdgar(ticker);
  } catch (e) {
    lastErr = e;
  }

  // ── Stage 2: FMP fallback if EDGAR returned nothing ───────────────────────
  if (!payload) {
    try {
      payload = await _tryFmp(ticker);
    } catch (e) {
      if (!lastErr) lastErr = e;
    }
  }

  // ── Stage 3: Both failed ───────────────────────────────────────────────────
  if (!payload) {
    if (lastErr) {
      const timedOut = lastErr.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({
        ok: false,
        error: timedOut ? 'Data providers timed out — try again' : 'Financial data unavailable',
        retryable: true,
      });
    }
    return res.status(404).json({ ok: false, error: 'No financial data found for this ticker' });
  }

  // ── Cache only non-empty results ───────────────────────────────────────────
  const hasData = payload.incomeStatement.length > 0
    || payload.balanceSheet.length > 0
    || payload.cashFlow.length > 0;
  if (hasData) {
    _finCache.set(cacheKey, { data: payload, time: Date.now() });
  }

  return res.status(200).json({ ok: true, cached: false, ...payload });
};
