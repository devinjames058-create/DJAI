// ── Server-side in-memory cache (per Vercel warm instance) ────────────────────
const _dataCache = new Map(); // sym → { data, time }
// Normal TTL: 15 minutes — prevents FMP free-tier exhaustion on repeated searches
const CACHE_TTL_MS = 15 * 60 * 1000;
// To test FreshnessIndicator transitions (Live→Recent→Stale), temporarily use:
// const CACHE_TTL_MS = 5 * 1000;

// ── FMP daily request counter (module-level, resets at UTC midnight) ──────────
// With 9 FMP calls per /api/data request and 250/day free-tier cap,
// this gives ~27 full ticker fetches per day.
let _fmpDay   = '';
let _fmpCount = 0;
const FMP_WARN_AT = 200;
const FMP_STOP_AT = 245;
const FMP_BASE    = 'https://financialmodelingprep.com/api/v3';

function _fmpFetch(path, key) {
  const today = new Date().toISOString().slice(0, 10);
  if (_fmpDay !== today) { _fmpDay = today; _fmpCount = 0; }
  _fmpCount++;
  if (_fmpCount > FMP_STOP_AT) {
    return Promise.reject(new Error(
      `FMP daily limit reached (${FMP_STOP_AT}/250). Resets at UTC midnight.`
    ));
  }
  if (_fmpCount > FMP_WARN_AT) {
    console.warn(`[FMP] Warning: ${_fmpCount}/250 daily requests used`);
  }
  const sep = path.includes('?') ? '&' : '?';
  return fetch(`${FMP_BASE}${path}${sep}apikey=${key}`);
}

// ── Formatting helpers ─────────────────────────────────────────────────────────
function fmtLarge(n, prefix = '$') {
  if (n == null || isNaN(n)) return null;
  const abs = Math.abs(Number(n));
  if (abs >= 1e12) return `${prefix}${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${prefix}${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${prefix}${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${prefix}${(n / 1e3).toFixed(1)}K`;
  return `${prefix}${Number(n).toFixed(2)}`;
}
function fmtPrice(n)    { return n != null ? `$${Number(n).toFixed(2)}` : null; }
function fmtPct(n)      { return n != null ? `${(Number(n) * 100).toFixed(2)}%` : null; }
function fmtNum(n, dp = 2) { return n != null ? Number(n).toFixed(dp) : null; }
function fmtVol(n) {
  if (n == null) return null;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

// ── Safe JSON parser ───────────────────────────────────────────────────────────
async function safeJson(settled) {
  try {
    if (settled.status === 'fulfilled') return await settled.value.json();
  } catch(e) {}
  return null;
}

// ── Handler ────────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Fail fast if FMP key is missing
  const FMP_KEY = process.env.FMP_API_KEY;
  if (!FMP_KEY) {
    return res.status(503).json({ error: 'FMP_API_KEY not configured', retryable: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }
  const { ticker } = body || {};
  if (!ticker) return res.status(400).json({ error: 'No ticker provided' });

  const sym = encodeURIComponent(ticker.toUpperCase());
  const reqId = Math.random().toString(36).slice(2, 9);
  const now   = Date.now();

  // ── Cache hit — return without calling FMP ──────────────────────────────────
  const hit    = _dataCache.get(sym);
  const hitAge = hit ? now - hit.time : Infinity;
  if (hit && hitAge < CACHE_TTL_MS) {
    return res.status(200).json({
      success: true,
      data: hit.data,
      meta: {
        source: 'fmp', cached: true, stale: false,
        servedStaleAfterError: false,
        timestamp: new Date(hit.time).toISOString(),
        ageSeconds: Math.round(hitAge / 1000),
        requestId: reqId
      }
    });
  }

  // ── Fire all requests in parallel ─────────────────────────────────────────
  const [
    fmpQuoteRes, fmpProfileRes,
    fmpIncomeRes, fmpBalanceRes, fmpCashRes,
    fmpKMRes, fmpRatioRes, fmpDcfRes, fmpNewsRes,
    fredRes
  ] = await Promise.allSettled([
    _fmpFetch(`/quote/${sym}`,                        FMP_KEY),  // 1
    _fmpFetch(`/profile/${sym}`,                      FMP_KEY),  // 2
    _fmpFetch(`/income-statement/${sym}?limit=5`,     FMP_KEY),  // 3
    _fmpFetch(`/balance-sheet-statement/${sym}?limit=5`, FMP_KEY), // 4
    _fmpFetch(`/cash-flow-statement/${sym}?limit=5`,  FMP_KEY),  // 5
    _fmpFetch(`/key-metrics/${sym}?limit=2`,          FMP_KEY),  // 6
    _fmpFetch(`/ratios/${sym}?limit=2`,               FMP_KEY),  // 7
    _fmpFetch(`/discounted-cash-flow/${sym}`,         FMP_KEY),  // 8
    _fmpFetch(`/stock_news?tickers=${sym}&limit=10`,  FMP_KEY),  // 9
    // FRED — 10Y treasury yield (free, no key needed)
    fetch('https://fred.stlouisfed.org/graph/fredgraph.json?id=DGS10')
  ]);

  const [
    fmpQuoteRaw, fmpProfileRaw,
    fmpIncomeRaw, fmpBalanceRaw, fmpCashRaw,
    fmpKMRaw, fmpRatioRaw, fmpDcfRaw, fmpNewsRaw,
    fredRaw
  ] = await Promise.all([
    safeJson(fmpQuoteRes), safeJson(fmpProfileRes),
    safeJson(fmpIncomeRes), safeJson(fmpBalanceRes), safeJson(fmpCashRes),
    safeJson(fmpKMRes), safeJson(fmpRatioRes), safeJson(fmpDcfRes), safeJson(fmpNewsRes),
    safeJson(fredRes)
  ]);

  // ── Unwrap arrays ──────────────────────────────────────────────────────────
  const fmpQ       = Array.isArray(fmpQuoteRaw)   ? fmpQuoteRaw[0]   : fmpQuoteRaw;
  const fmpP       = Array.isArray(fmpProfileRaw) ? fmpProfileRaw[0] : fmpProfileRaw;
  const fmpIncome  = Array.isArray(fmpIncomeRaw)  ? fmpIncomeRaw     : [];
  const fmpBalance = Array.isArray(fmpBalanceRaw) ? fmpBalanceRaw    : [];
  const fmpCash    = Array.isArray(fmpCashRaw)    ? fmpCashRaw       : [];
  const fmpKM      = Array.isArray(fmpKMRaw)      ? fmpKMRaw[0]      : fmpKMRaw;
  const fmpRatio   = Array.isArray(fmpRatioRaw)   ? fmpRatioRaw[0]   : fmpRatioRaw;
  const fmpDcf     = Array.isArray(fmpDcfRaw)     ? fmpDcfRaw[0]     : fmpDcfRaw;
  const fmpNews    = Array.isArray(fmpNewsRaw)    ? fmpNewsRaw       : [];

  // ── FRED — Risk-Free Rate ──────────────────────────────────────────────────
  let riskFreeRate = null;
  try {
    const obs = fredRaw?.observations || (Array.isArray(fredRaw) ? fredRaw : []);
    if (obs.length > 0) {
      const latest = obs[obs.length - 1];
      const val = parseFloat(latest.value);
      if (!isNaN(val)) riskFreeRate = val / 100;
    }
  } catch(e) {}

  // ── Revenue growth / earnings growth from income statement ────────────────
  let revenueGrowth = null;
  let earningsGrowth = null;
  if (fmpIncome.length >= 2) {
    const r0 = fmpIncome[0]?.revenue, r1 = fmpIncome[1]?.revenue;
    const e0 = fmpIncome[0]?.netIncome, e1 = fmpIncome[1]?.netIncome;
    if (r0 && r1 && r1 !== 0) revenueGrowth  = fmtPct((r0 - r1) / Math.abs(r1));
    if (e0 && e1 && e1 !== 0) earningsGrowth = fmtPct((e0 - e1) / Math.abs(e1));
  }

  // ── Next Earnings Date — from FMP quote earningsAnnouncement ─────────────
  const calendar = (() => {
    try {
      const ea = fmpQ?.earningsAnnouncement;
      const latestQ = fmpIncome[0]?.date ?? null;
      if (!ea) {
        // Fallback: latestQuarter + ~91 days
        if (latestQ) {
          const d = new Date(latestQ); d.setDate(d.getDate() + 91);
          const est = d.toISOString().split('T')[0];
          const days = Math.round((d - Date.now()) / 86400000);
          return { nextEarningsDate: null, nextEarningsDaysAway: days, nextEarningsDateEstimated: true, nextEarningsDateEstimate: est, latestQuarter: latestQ };
        }
        return { nextEarningsDate: null, nextEarningsDaysAway: null, nextEarningsDateEstimated: false, nextEarningsDateEstimate: null, latestQuarter: latestQ };
      }
      const d = new Date(ea);
      const days = Math.round((d - Date.now()) / 86400000);
      const fmt = d.toISOString().split('T')[0];
      return { nextEarningsDate: fmt, nextEarningsDaysAway: days, nextEarningsDateEstimated: false, nextEarningsDateEstimate: null, latestQuarter: latestQ };
    } catch(e) {
      return { nextEarningsDate: null, nextEarningsDaysAway: null, nextEarningsDateEstimated: false, nextEarningsDateEstimate: null, latestQuarter: null };
    }
  })();

  // ── Historical Financials (4 years) ───────────────────────────────────────
  const historicalFinancials = fmpIncome.slice(0, 4).map((inc, i) => {
    const bal = fmpBalance[i] || {};
    const cf  = fmpCash[i]    || {};
    return {
      year:               inc.calendarYear || inc.date?.slice(0, 4),
      revenue:            inc.revenue            ?? null,
      grossProfit:        inc.grossProfit         ?? null,
      operatingIncome:    inc.operatingIncome     ?? null,
      netIncome:          inc.netIncome           ?? null,
      ebitda:             inc.ebitda              ?? null,
      eps:                inc.eps                 ?? null,
      totalAssets:        bal.totalAssets         ?? null,
      totalDebt:          bal.totalDebt           ?? null,
      cashAndEquivalents: bal.cashAndCashEquivalents ?? bal.cashAndShortTermInvestments ?? null,
      shareholderEquity:  bal.totalStockholdersEquity ?? null,
      operatingCashflow:  cf.operatingCashFlow    ?? null,
      capex:              cf.capitalExpenditure   ?? null,   // negative in FMP
      freeCashflow:       cf.freeCashFlow         ?? null,
      dividendsPaid:      cf.dividendsPaid        ?? null    // negative in FMP
    };
  });

  // ── Assemble final data contract ───────────────────────────────────────────
  const aggregated = {
    ticker: ticker.toUpperCase(),
    dataTimestamp: new Date().toISOString(),
    fmpDailyRequestCount: _fmpCount,

    // LIVE QUOTE
    quote: {
      companyName:      fmpP?.companyName || fmpQ?.name || ticker,
      price:            fmpQ?.price ?? null,
      priceFormatted:   fmtPrice(fmpQ?.price),
      priceChange:      fmpQ?.change ?? null,
      priceChangePct:   fmpQ?.changesPercentage != null
                          ? `${fmpQ.changesPercentage >= 0 ? '+' : ''}${Number(fmpQ.changesPercentage).toFixed(2)}%`
                          : null,
      open:             fmtPrice(fmpQ?.open),
      dayHigh:          fmtPrice(fmpQ?.dayHigh),
      dayLow:           fmtPrice(fmpQ?.dayLow),
      previousClose:    fmtPrice(fmpQ?.previousClose),
      volume:           fmtVol(fmpQ?.volume),
      avgVolume:        fmtVol(fmpQ?.avgVolume),
      marketState:      null,  // FMP free tier does not expose market state
      currency:         fmpP?.currency || 'USD',
      exchange:         fmpQ?.exchange || fmpP?.exchangeShortName || null
    },

    // VALUATION METRICS
    valuation: {
      marketCap:           fmtLarge(fmpQ?.marketCap),
      marketCapRaw:        fmpQ?.marketCap ?? null,
      enterpriseValue:     fmtLarge(fmpKM?.enterpriseValue),
      pe:                  fmpQ?.pe != null ? fmtNum(fmpQ.pe) : fmtNum(fmpKM?.peRatio),
      forwardPE:           null,  // Not available on FMP free tier
      pegRatio:            fmtNum(fmpRatio?.priceEarningsToGrowthRatio),
      priceToBook:         fmtNum(fmpKM?.pbRatio),
      priceToSales:        fmtNum(fmpKM?.priceToSalesRatio),
      evToEbitda:          fmtNum(fmpKM?.enterpriseValueOverEBITDA),
      evToRevenue:         fmtNum(fmpKM?.evToSales),
      eps:                 fmpQ?.eps != null ? `$${Number(fmpQ.eps).toFixed(2)}` : null,
      forwardEps:          null,
      bookValue:           (() => {
        const eq = fmpBalance[0]?.totalStockholdersEquity;
        const sh = fmpQ?.sharesOutstanding;
        return (eq && sh) ? fmtNum(eq / sh) : null;
      })(),
      week52High:          fmtPrice(fmpQ?.yearHigh),
      week52Low:           fmtPrice(fmpQ?.yearLow),
      fiftyDayAvg:         fmtPrice(fmpQ?.priceAvg50),
      twoHundredDayAvg:    fmtPrice(fmpQ?.priceAvg200),
      sharesOutstanding:   fmtVol(fmpQ?.sharesOutstanding),
      sharesOutstandingRaw:fmpQ?.sharesOutstanding ?? null,
      beta:                fmpP?.beta != null ? fmtNum(fmpP.beta) : null,
      dividendYield:       fmpKM?.dividendYield != null ? fmtPct(fmpKM.dividendYield) : null,
      dividendPerShare:    fmpP?.lastDiv != null ? `$${Number(fmpP.lastDiv).toFixed(2)}` : null,
      payoutRatio:         fmtNum(fmpKM?.payoutRatio)
    },

    // COMPANY PROFILE
    profile: {
      sector:            fmpP?.sector           ?? null,
      industry:          fmpP?.industry         ?? null,
      description:       fmpP?.description      ?? null,
      employees:         fmpP?.fullTimeEmployees ?? null,
      country:           fmpP?.country          ?? null,
      fiscalYearEnd:     fmpIncome[0]?.date     ?? null,
      latestQuarter:     fmpIncome[0]?.date     ?? null,
      // FMP DCF intrinsic value (dedicated endpoint preferred; profile.dcf as fallback)
      analystTargetPrice: fmpDcf?.dcf != null ? fmtNum(fmpDcf.dcf) : (fmpP?.dcf != null ? fmtNum(fmpP.dcf) : null),
      analystRating:     null,
      numberOfAnalysts:  null
    },

    // CURRENT FINANCIALS (most recent annual from FMP statements)
    currentFinancials: {
      revenue:           fmtLarge(fmpIncome[0]?.revenue),
      revenueRaw:        fmpIncome[0]?.revenue ?? null,
      grossMargin:       fmtPct(fmpRatio?.grossProfitMargin),
      operatingMargin:   fmtPct(fmpRatio?.operatingProfitMargin),
      profitMargin:      fmtPct(fmpRatio?.netProfitMargin),
      ebitdaMargin:      fmpIncome[0]?.ebitdaratio != null ? fmtPct(fmpIncome[0].ebitdaratio) : null,
      totalCash:         fmtLarge(fmpBalance[0]?.cashAndShortTermInvestments),
      totalCashRaw:      fmpBalance[0]?.cashAndShortTermInvestments ?? null,
      totalDebt:         fmtLarge(fmpBalance[0]?.totalDebt),
      totalDebtRaw:      fmpBalance[0]?.totalDebt ?? null,
      debtToEquity:      fmtNum(fmpKM?.debtToEquity),
      freeCashflow:      fmtLarge(fmpCash[0]?.freeCashFlow),
      freeCashflowRaw:   fmpCash[0]?.freeCashFlow ?? null,
      operatingCashflow: fmtLarge(fmpCash[0]?.operatingCashFlow),
      returnOnEquity:    fmtPct(fmpRatio?.returnOnEquity),
      returnOnAssets:    fmtPct(fmpRatio?.returnOnAssets),
      revenueGrowth,
      earningsGrowth,
      currentRatio:      fmtNum(fmpKM?.currentRatio),
      quickRatio:        fmtNum(fmpRatio?.quickRatio)
    },

    // HISTORICAL FINANCIALS (4 years)
    historicalFinancials,

    // ANALYST DATA — price-target consensus not on FMP free tier; DCF intrinsic used as proxy
    analystData: {
      targetMean:        fmpDcf?.dcf != null ? fmtNum(fmpDcf.dcf) : (fmpP?.dcf != null ? fmtNum(fmpP.dcf) : null),
      targetHigh:        null,
      targetLow:         null,
      recommendation:    null,
      numberOfAnalysts:  null
    },

    // MACRO — FRED 10Y
    macro: {
      riskFreeRate:       riskFreeRate,
      riskFreeRatePct:    riskFreeRate ? (riskFreeRate * 100).toFixed(2) + '%' : null,
      riskFreeRateSource: '10Y US Treasury (FRED)'
    },

    // CALENDAR — Earnings
    calendar,

    // NEWS — FMP stock news
    news: fmpNews.slice(0, 8).map(n => ({
      headline:    n.title     || '',
      url:         n.url       || null,
      source:      n.site      || 'Financial Modeling Prep',
      publishedAt: n.publishedDate ? n.publishedDate.slice(0, 10) : '',
      thumbnail:   n.image     || null
    })).filter(n => n.headline)
  };

  // ── Cache write + meta ──────────────────────────────────────────────────────
  // If primary data came back empty (e.g. FMP 429 / bad ticker), serve stale cache
  const primaryMissing = aggregated.quote?.price == null;
  if (primaryMissing && hit) {
    return res.status(200).json({
      success: true,
      data: hit.data,
      meta: {
        source: 'fmp', cached: true, stale: true,
        servedStaleAfterError: true,
        timestamp: new Date(hit.time).toISOString(),
        ageSeconds: Math.round((now - hit.time) / 1000),
        requestId: reqId,
        error: 'FMP returned empty data — serving cached response'
      }
    });
  }
  // Good fresh data — cache it and return with live meta
  if (!primaryMissing) _dataCache.set(sym, { data: aggregated, time: now });
  return res.status(200).json({
    success: true,
    data: aggregated,
    meta: {
      source: 'fmp', cached: false, stale: primaryMissing,
      servedStaleAfterError: false,
      timestamp: new Date().toISOString(),
      ageSeconds: 0,
      requestId: reqId
    }
  });
};
