'use strict';
// ── Financials API — SEC EDGAR XBRL companyfacts ──────────────────────────
// No API key required. Works for every SEC-registered public company.
// Two fetches per ticker (cold): company_tickers.json → CIK, then companyfacts.
// Cache: ticker→CIK map (24 h), companyfacts per CIK (7 days).

const EDGAR_BASE  = 'https://data.sec.gov';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const HEADERS     = { 'User-Agent': 'DJAI Finance dev@djai.app', 'Accept': 'application/json' };
const TIMEOUT     = 20000;

// Ticker→CIK map (refreshed every 24 h — the file rarely changes)
let _tickerMap     = null;
let _tickerMapTime = 0;
const TICKER_TTL   = 24 * 60 * 60 * 1000;

// Per-CIK companyfacts cache (7-day TTL — only updates on new filings)
const _factsCache = new Map();
const FACTS_TTL   = 7 * 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

async function _get(url, signal) {
  const r = await fetch(url, { headers: HEADERS, signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${url}`);
  return r.json();
}

// ── Step 1: resolve ticker → zero-padded 10-digit CIK ─────────────────────

async function _getCIK(ticker) {
  const now = Date.now();
  if (!_tickerMap || now - _tickerMapTime > TICKER_TTL) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const raw = await _get(TICKERS_URL, ctrl.signal);
      clearTimeout(timer);
      // raw: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... }
      const map = {};
      for (const e of Object.values(raw)) {
        if (e.ticker) map[e.ticker.toUpperCase()] = String(e.cik_str).padStart(10, '0');
      }
      _tickerMap     = map;
      _tickerMapTime = now;
    } catch (e) {
      clearTimeout(timer);
      throw new Error('SEC ticker list unavailable: ' + e.message);
    }
  }
  const cik = _tickerMap[ticker.toUpperCase()];
  if (!cik) throw new Error(`${ticker} not found in SEC EDGAR`);
  return cik;
}

// ── Step 2: fetch companyfacts (all XBRL facts in one call) ───────────────

async function _getCompanyFacts(cik) {
  const now    = Date.now();
  const cached = _factsCache.get(cik);
  if (cached && now - cached.time < FACTS_TTL) return cached.data;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const data = await _get(`${EDGAR_BASE}/api/xbrl/companyfacts/CIK${cik}.json`, ctrl.signal);
    clearTimeout(timer);
    _factsCache.set(cik, { data, time: now });
    return data;
  } catch (e) {
    clearTimeout(timer);
    throw new Error('companyfacts unavailable: ' + e.message);
  }
}

// ── Step 3: extract annual FY values from us-gaap facts ───────────────────

// Returns sorted array of annual FY entries for the first matching tag.
function _getRows(gaap, ...tags) {
  for (const tag of tags) {
    const arr = gaap?.[tag]?.units?.USD;
    if (!arr?.length) continue;
    // Keep only annual full-year 10-K rows
    const annual = arr.filter(d => d.form === '10-K' && d.fp === 'FY' && d.val != null);
    if (!annual.length) continue;
    // Dedupe by fiscal year — keep latest-filed entry per FY
    const byFy = {};
    for (const d of annual) {
      const fy = d.fy ?? parseInt(d.end?.slice(0, 4), 10);
      if (fy && (!byFy[fy] || d.filed > byFy[fy].filed)) byFy[fy] = d;
    }
    return Object.values(byFy).sort((a, b) => (b.fy ?? 0) - (a.fy ?? 0));
  }
  return [];
}

// Builds a FY→value map for quick lookup.
function _map(gaap, ...tags) {
  const m = {};
  for (const d of _getRows(gaap, ...tags)) {
    const fy = d.fy ?? parseInt(d.end?.slice(0, 4), 10);
    if (fy) m[fy] = d.val;
  }
  return m;
}

// ── Step 4: build normalized statement arrays ──────────────────────────────

function _buildIS(gaap, years, shMap) {
  const rev  = _map(gaap, 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax');
  const cogs = _map(gaap, 'CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold');
  const gp   = _map(gaap, 'GrossProfit');
  const rd   = _map(gaap, 'ResearchAndDevelopmentExpense');
  const sga  = _map(gaap, 'SellingGeneralAndAdministrativeExpense');
  const oi   = _map(gaap, 'OperatingIncomeLoss');
  const iexp = _map(gaap, 'InterestExpense');
  const ni   = _map(gaap, 'NetIncomeLoss');
  const eps  = _map(gaap, 'EarningsPerShareDiluted');

  return years.map(yr => {
    const r    = rev[yr]  ?? null;
    const c    = cogs[yr] ?? null;
    const g    = gp[yr]   ?? (r != null && c != null ? r - c : null);
    const o    = oi[yr]   ?? null;
    const n    = ni[yr]   ?? null;
    const sh   = shMap[yr] ?? null;
    return {
      year:            yr,
      revenue:         r,
      costOfRevenue:   c,
      grossProfit:     g,
      grossMargin:     g != null && r ? g / r : null,
      rd:              rd[yr]   ?? null,
      sga:             sga[yr]  ?? null,
      operatingIncome: o,
      operatingMargin: o != null && r ? o / r : null,
      interestExpense: iexp[yr] ?? null,
      netIncome:       n,
      netMargin:       n != null && r ? n / r : null,
      epsDiluted:      eps[yr]  ?? null,
      sharesOutDiluted: sh,
    };
  });
}

function _buildBS(gaap, years, shMap) {
  const cash   = _map(gaap, 'CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalentsFairValueDisclosure');
  const curA   = _map(gaap, 'AssetsCurrent');
  const totA   = _map(gaap, 'Assets');
  const curL   = _map(gaap, 'LiabilitiesCurrent');
  const ltd    = _map(gaap, 'LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations');
  const totL   = _map(gaap, 'Liabilities');
  const eq     = _map(gaap, 'StockholdersEquity', 'StockholdersEquityAttributableToParent');

  return years.map(yr => {
    const e  = eq[yr]    ?? null;
    const sh = shMap[yr] ?? null;
    return {
      year:               yr,
      cash:               cash[yr]  ?? null,
      currentAssets:      curA[yr]  ?? null,
      totalAssets:        totA[yr]  ?? null,
      currentLiabilities: curL[yr]  ?? null,
      longTermDebt:       ltd[yr]   ?? null,
      totalLiabilities:   totL[yr]  ?? null,
      equity:             e,
      bookValuePerShare:  e != null && sh && sh > 0 ? e / sh : null,
    };
  });
}

function _buildCF(gaap, years) {
  const opCF   = _map(gaap, 'NetCashProvidedByUsedInOperatingActivities');
  const capex  = _map(gaap, 'PaymentsToAcquirePropertyPlantAndEquipment');
  const invCF  = _map(gaap, 'NetCashProvidedByUsedInInvestingActivities');
  const finCF  = _map(gaap, 'NetCashProvidedByUsedInFinancingActivities');
  const divs   = _map(gaap, 'PaymentsOfDividends', 'PaymentsOfDividendsCommonStock');
  const buyb   = _map(gaap, 'PaymentsForRepurchaseOfCommonStock');

  return years.map(yr => {
    const op  = opCF[yr]  ?? null;
    const cap = capex[yr] ?? null;   // XBRL stores as positive outflow
    const capNeg = cap != null ? -Math.abs(cap) : null;
    const fcf = op != null && cap != null ? op - Math.abs(cap) : null;
    return {
      year:           yr,
      operatingCF:    op,
      capex:          capNeg,
      freeCashFlow:   fcf,
      investingCF:    invCF[yr] ?? null,
      financingCF:    finCF[yr] ?? null,
      // Outflows stored as positive in XBRL — normalize to negative for display
      dividendsPaid:  divs[yr] != null ? -Math.abs(divs[yr]) : null,
      shareRepurchases: buyb[yr] != null ? -Math.abs(buyb[yr]) : null,
    };
  });
}

// ── Main handler ───────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }

  const ticker = (body?.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  try {
    const cik        = await _getCIK(ticker);
    const facts      = await _getCompanyFacts(cik);
    const entityName = facts.entityName ?? facts.name ?? ticker;
    const gaap       = facts?.facts?.['us-gaap'] ?? {};

    // Determine the last 5 fiscal years from revenue (most reliably reported)
    const revRows = _getRows(gaap,
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
    );
    const years = revRows.slice(0, 5).map(d => d.fy).filter(Boolean);

    if (!years.length) {
      return res.status(200).json({
        ok: true, source: 'SEC EDGAR (XBRL)', cik, entityName,
        incomeStatement: [], balanceSheet: [], cashFlow: [],
        warning: 'No annual XBRL revenue data found — company may not file 10-K with US GAAP XBRL',
      });
    }

    // Shares outstanding used by both IS and BS for per-share metrics
    const shMap = _map(gaap, 'WeightedAverageNumberOfDilutedSharesOutstanding');

    return res.status(200).json({
      ok:              true,
      source:          'SEC EDGAR (XBRL)',
      cik,
      entityName,
      incomeStatement: _buildIS(gaap, years, shMap),
      balanceSheet:    _buildBS(gaap, years, shMap),
      cashFlow:        _buildCF(gaap, years),
    });
  } catch (e) {
    const notFound  = e.message.includes('not found in SEC EDGAR');
    const timedOut  = e.name === 'AbortError';
    return res.status(notFound ? 404 : timedOut ? 504 : 500).json({
      ok: false, error: e.message, retryable: !notFound,
    });
  }
};
