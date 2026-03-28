'use strict';
// ── Financials API — fetches 3 FMP statements for a ticker ───────────────────
// Returns: { incomeStatement, balanceSheet, cashFlow } — each is an array of
// up to 5 annual periods, most recent first.
// Cached 24 hours per symbol (same TTL as fundamentals in CLAUDE.md).

const _cache = new Map(); // sym → { data, time }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
const FMP_BASE  = 'https://financialmodelingprep.com/api/v3';
const TIMEOUT   = 12000;

function _fmpFetch(path, key, signal) {
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${FMP_BASE}${path}${sep}apikey=${key}`, { signal });
}

async function _safeJson(p) {
  try { return await (await p).json(); } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const ticker = (body?.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return res.status(503).json({ ok: false, error: 'FMP_API_KEY not configured' });

  // ── Cache check ─────────────────────────────────────────────────────────────
  const cached = _cache.get(ticker);
  if (cached && (Date.now() - cached.time < CACHE_TTL)) {
    return res.status(200).json({ ok: true, cached: true, ...cached.data });
  }

  // ── Fetch all 3 statements in parallel ──────────────────────────────────────
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    const [isRaw, bsRaw, cfRaw] = await Promise.all([
      _safeJson(_fmpFetch(`/income-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal)),
      _safeJson(_fmpFetch(`/balance-sheet-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal)),
      _safeJson(_fmpFetch(`/cash-flow-statement/${encodeURIComponent(ticker)}?limit=5`, KEY, ctrl.signal)),
    ]);
    clearTimeout(timer);

    const incomeStatement = _normalizeIS(isRaw  || []);
    const balanceSheet    = _normalizeBS(bsRaw  || []);
    const cashFlow        = _normalizeCF(cfRaw  || []);

    const data = { incomeStatement, balanceSheet, cashFlow };
    _cache.set(ticker, { data, time: Date.now() });

    return res.status(200).json({ ok: true, cached: false, ...data });
  } catch(e) {
    clearTimeout(timer);
    const timedOut = e.name === 'AbortError';
    return res.status(timedOut ? 504 : 500).json({
      ok: false,
      error: timedOut ? 'FMP timed out' : e.message,
      retryable: true,
    });
  }
};

// ── Normalizers — extract only the fields we display ─────────────────────────

function _normalizeIS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:              r.date              ?? null,
    period:            r.period            ?? null,
    calendarYear:      r.calendarYear      ?? null,
    revenue:           r.revenue           ?? null,
    costOfRevenue:     r.costOfRevenue     ?? null,
    grossProfit:       r.grossProfit       ?? null,
    researchAndDevelopmentExpenses: r.researchAndDevelopmentExpenses ?? null,
    sellingGeneralAndAdministrativeExpenses: r.sellingGeneralAndAdministrativeExpenses ?? null,
    operatingExpenses: r.operatingExpenses ?? null,
    operatingIncome:   r.operatingIncome   ?? null,
    interestExpense:   r.interestExpense   ?? null,
    incomeBeforeTax:   r.incomeBeforeTax   ?? null,
    netIncome:         r.netIncome         ?? null,
    eps:               r.eps               ?? null,
    epsDiluted:        r.epsDiluted        ?? null,
    weightedAverageShsOutDil: r.weightedAverageShsOutDil ?? null,
    ebitda:            r.ebitda            ?? null,
  }));
}

function _normalizeBS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:                  r.date                  ?? null,
    period:                r.period                ?? null,
    calendarYear:          r.calendarYear          ?? null,
    cashAndCashEquivalents: r.cashAndCashEquivalents ?? null,
    shortTermInvestments:  r.shortTermInvestments  ?? null,
    totalCurrentAssets:    r.totalCurrentAssets    ?? null,
    totalAssets:           r.totalAssets           ?? null,
    totalCurrentLiabilities: r.totalCurrentLiabilities ?? null,
    longTermDebt:          r.longTermDebt          ?? null,
    totalDebt:             r.totalDebt             ?? null,
    totalLiabilities:      r.totalLiabilities      ?? null,
    totalStockholdersEquity: r.totalStockholdersEquity ?? null,
    bookValuePerShare:     r.bookValuePerShare      ?? null,
    retainedEarnings:      r.retainedEarnings       ?? null,
  }));
}

function _normalizeCF(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(r => ({
    date:                    r.date                    ?? null,
    period:                  r.period                  ?? null,
    calendarYear:            r.calendarYear            ?? null,
    operatingCashFlow:       r.operatingCashFlow       ?? null,
    capitalExpenditure:      r.capitalExpenditure      ?? null,
    freeCashFlow:            r.freeCashFlow            ?? null,
    acquisitionsNet:         r.acquisitionsNet         ?? null,
    dividendsPaid:           r.dividendsPaid           ?? null,
    commonStockRepurchased:  r.commonStockRepurchased  ?? null,
    netCashProvidedByInvestingActivities: r.netCashProvidedByInvestingActivities ?? null,
    netCashUsedForInvestingActivites: r.netCashUsedForInvestingActivites ?? null,
    netCashUsedProvidedByFinancingActivities: r.netCashUsedProvidedByFinancingActivities ?? null,
    netChangeInCash:         r.netChangeInCash         ?? null,
  }));
}
