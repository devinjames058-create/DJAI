module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) {}
  }

  const { ticker } = body || {};
  if (!ticker) return res.status(400).json({ error: 'No ticker provided' });

  const RAPID_KEY = process.env.RAPIDAPI_KEY;
  const AV_KEY = process.env.ALPHA_VANTAGE_KEY;
  const YF_HOST = 'yahoo-finance166.p.rapidapi.com';
  const yfHeaders = {
    'x-rapidapi-key': RAPID_KEY,
    'x-rapidapi-host': YF_HOST,
    'Content-Type': 'application/json'
  };

  // ── Run all sources in parallel ──────────────────────────────────
  const [
    yfPriceRes, yfStatsRes, yfFinancialRes,
    avIncomeRes, avBalanceRes, avCashflowRes, avOverviewRes,
    fredRes
  ] = await Promise.allSettled([
    // Yahoo Finance — price, stats, financials
    fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=${encodeURIComponent(ticker)}`, { headers: yfHeaders }),
    fetch(`https://${YF_HOST}/api/stock/stockGetStatistics?region=US&symbol=${encodeURIComponent(ticker)}`, { headers: yfHeaders }),
    fetch(`https://${YF_HOST}/api/stock/get-financial-data?region=US&symbol=${encodeURIComponent(ticker)}`, { headers: yfHeaders }),
    // Alpha Vantage — income statement (5 years)
    fetch(`https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`),
    // Alpha Vantage — balance sheet
    fetch(`https://www.alphavantage.co/query?function=BALANCE_SHEET&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`),
    // Alpha Vantage — cash flow
    fetch(`https://www.alphavantage.co/query?function=CASH_FLOW&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`),
    // Alpha Vantage — company overview (sector, industry, description, PE, EPS, beta)
    fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${AV_KEY}`),
    // FRED — 10Y treasury yield (risk-free rate for WACC)
    fetch(`https://fred.stlouisfed.org/graph/fredgraph.json?id=DGS10&vintage_date=${new Date().toISOString().split('T')[0]}`)
  ]);

  // ── Parse responses safely ────────────────────────────────────────
  const safeJson = async (settled) => {
    try {
      if (settled.status === 'fulfilled') return await settled.value.json();
    } catch(e) {}
    return null;
  };

  const [
    yfPrice, yfStats, yfFinancial,
    avIncome, avBalance, avCashflow, avOverview,
    fredData
  ] = await Promise.all([
    safeJson(yfPriceRes), safeJson(yfStatsRes), safeJson(yfFinancialRes),
    safeJson(avIncomeRes), safeJson(avBalanceRes), safeJson(avCashflowRes), safeJson(avOverviewRes),
    safeJson(fredRes)
  ]);

  // ── Extract Yahoo Finance data ────────────────────────────────────
  const p = yfPrice?.quoteSummary?.result?.[0]?.price || {};
  const s = yfStats?.quoteSummary?.result?.[0]?.summaryDetail || {};
  const ks = yfStats?.quoteSummary?.result?.[0]?.defaultKeyStatistics || {};
  const f = yfFinancial?.quoteSummary?.result?.[0]?.financialData || {};

  // ── Extract Alpha Vantage — Annual Financials (last 4 years) ─────
  const annualIncome = avIncome?.annualReports?.slice(0, 4) || [];
  const annualBalance = avBalance?.annualReports?.slice(0, 4) || [];
  const annualCashflow = avCashflow?.annualReports?.slice(0, 4) || [];

  const historicalFinancials = annualIncome.map((inc, i) => {
    const bal = annualBalance[i] || {};
    const cf = annualCashflow[i] || {};
    return {
      year: inc.fiscalDateEnding?.slice(0, 4),
      revenue: Number(inc.totalRevenue) || null,
      grossProfit: Number(inc.grossProfit) || null,
      operatingIncome: Number(inc.operatingIncome) || null,
      netIncome: Number(inc.netIncome) || null,
      ebitda: Number(inc.ebitda) || null,
      eps: Number(inc.reportedEPS) || null,
      totalAssets: Number(bal.totalAssets) || null,
      totalDebt: Number(bal.shortLongTermDebtTotal) || null,
      cashAndEquivalents: Number(bal.cashAndCashEquivalentsAtCarryingValue) || null,
      shareholderEquity: Number(bal.totalShareholderEquity) || null,
      operatingCashflow: Number(cf.operatingCashflow) || null,
      capex: Number(cf.capitalExpenditures) || null,
      freeCashflow: Number(cf.operatingCashflow) - Math.abs(Number(cf.capitalExpenditures)) || null,
      dividendsPaid: Number(cf.dividendPayout) || null
    };
  });

  // ── Extract FRED — Risk Free Rate ─────────────────────────────────
  let riskFreeRate = null;
  try {
    const fredObs = fredData?.observations || fredData;
    if (Array.isArray(fredObs) && fredObs.length > 0) {
      const latest = fredObs[fredObs.length - 1];
      riskFreeRate = parseFloat(latest.value) / 100;
    }
  } catch(e) {}

  // ── Build comprehensive aggregated data object ────────────────────
  const aggregated = {
    ticker: ticker.toUpperCase(),
    dataTimestamp: new Date().toISOString(),

    // LIVE QUOTE — Yahoo Finance
    quote: {
      companyName: p.longName || p.shortName || avOverview?.Name || ticker,
      price: p.regularMarketPrice?.raw ?? null,
      priceFormatted: p.regularMarketPrice?.fmt ?? null,
      priceChange: p.regularMarketChange?.raw ?? null,
      priceChangePct: p.regularMarketChangePercent?.fmt ?? null,
      open: p.regularMarketOpen?.fmt ?? null,
      dayHigh: p.regularMarketDayHigh?.fmt ?? null,
      dayLow: p.regularMarketDayLow?.fmt ?? null,
      previousClose: p.regularMarketPreviousClose?.fmt ?? null,
      volume: p.regularMarketVolume?.fmt ?? null,
      marketState: p.marketState ?? null,
      currency: p.currency ?? 'USD',
      exchange: p.exchangeName ?? null
    },

    // VALUATION METRICS — Yahoo Finance + Alpha Vantage
    valuation: {
      marketCap: p.marketCap?.fmt ?? s.marketCap?.fmt ?? null,
      marketCapRaw: p.marketCap?.raw ?? s.marketCap?.raw ?? null,
      enterpriseValue: avOverview?.EVToEBITDA ? null : null,
      pe: s.trailingPE?.fmt ?? avOverview?.PERatio ?? null,
      forwardPE: s.forwardPE?.fmt ?? avOverview?.ForwardPE ?? null,
      pegRatio: avOverview?.PEGRatio ?? null,
      priceToBook: ks.priceToBook?.fmt ?? avOverview?.PriceToBookRatio ?? null,
      priceToSales: avOverview?.PriceToSalesRatioTTM ?? null,
      evToEbitda: avOverview?.EVToEBITDA ?? null,
      evToRevenue: avOverview?.EVToRevenue ?? null,
      eps: ks.trailingEps?.fmt ?? avOverview?.EPS ?? null,
      forwardEps: avOverview?.ForwardAnnualEpsEstimate ?? null,
      bookValue: avOverview?.BookValue ?? null,
      week52High: s.fiftyTwoWeekHigh?.fmt ?? avOverview?.['52WeekHigh'] ?? null,
      week52Low: s.fiftyTwoWeekLow?.fmt ?? avOverview?.['52WeekLow'] ?? null,
      fiftyDayAvg: s.fiftyDayAverage?.fmt ?? avOverview?.['50DayMovingAverage'] ?? null,
      twoHundredDayAvg: s.twoHundredDayAverage?.fmt ?? avOverview?.['200DayMovingAverage'] ?? null,
      sharesOutstanding: ks.sharesOutstanding?.fmt ?? avOverview?.SharesOutstanding ?? null,
      sharesOutstandingRaw: ks.sharesOutstanding?.raw ?? Number(avOverview?.SharesOutstanding) ?? null,
      beta: s.beta?.fmt ?? avOverview?.Beta ?? null,
      dividendYield: s.dividendYield?.fmt ?? avOverview?.DividendYield ?? null,
      dividendPerShare: avOverview?.DividendPerShare ?? null,
      payoutRatio: avOverview?.PayoutRatio ?? null
    },

    // COMPANY PROFILE — Alpha Vantage
    profile: {
      sector: avOverview?.Sector ?? null,
      industry: avOverview?.Industry ?? null,
      description: avOverview?.Description ?? null,
      employees: avOverview?.FullTimeEmployees ?? null,
      country: avOverview?.Country ?? null,
      fiscalYearEnd: avOverview?.FiscalYearEnd ?? null,
      latestQuarter: avOverview?.LatestQuarter ?? null,
      analystTargetPrice: avOverview?.AnalystTargetPrice ?? f.targetMeanPrice?.raw ?? null,
      analystRating: f.recommendationKey ?? null,
      numberOfAnalysts: f.numberOfAnalystOpinions?.raw ?? null
    },

    // CURRENT FINANCIALS — Yahoo Finance
    currentFinancials: {
      revenue: f.totalRevenue?.fmt ?? null,
      revenueRaw: f.totalRevenue?.raw ?? null,
      grossMargin: f.grossMargins?.fmt ?? null,
      operatingMargin: f.operatingMargins?.fmt ?? null,
      profitMargin: f.profitMargins?.fmt ?? null,
      ebitdaMargin: avOverview?.EBITDAMargin ?? null,
      totalCash: f.totalCash?.fmt ?? null,
      totalCashRaw: f.totalCash?.raw ?? null,
      totalDebt: f.totalDebt?.fmt ?? null,
      totalDebtRaw: f.totalDebt?.raw ?? null,
      debtToEquity: f.debtToEquity?.fmt ?? null,
      freeCashflow: f.freeCashflow?.fmt ?? null,
      freeCashflowRaw: f.freeCashflow?.raw ?? null,
      operatingCashflow: f.operatingCashflow?.fmt ?? null,
      returnOnEquity: f.returnOnEquity?.fmt ?? avOverview?.ReturnOnEquityTTM ?? null,
      returnOnAssets: f.returnOnAssets?.fmt ?? avOverview?.ReturnOnAssetsTTM ?? null,
      revenueGrowth: f.revenueGrowth?.fmt ?? null,
      earningsGrowth: f.earningsGrowth?.fmt ?? null,
      currentRatio: f.currentRatio?.fmt ?? null,
      quickRatio: f.quickRatio?.fmt ?? null
    },

    // HISTORICAL FINANCIALS — Alpha Vantage (4 years)
    historicalFinancials,

    // ANALYST DATA
    analystData: {
      targetMean: f.targetMeanPrice?.fmt ?? avOverview?.AnalystTargetPrice ?? null,
      targetHigh: f.targetHighPrice?.fmt ?? null,
      targetLow: f.targetLowPrice?.fmt ?? null,
      recommendation: f.recommendationKey ?? null,
      numberOfAnalysts: f.numberOfAnalystOpinions?.raw ?? null
    },

    // MACRO — FRED
    macro: {
      riskFreeRate: riskFreeRate,
      riskFreeRatePct: riskFreeRate ? (riskFreeRate * 100).toFixed(2) + '%' : null,
      riskFreeRateSource: '10Y US Treasury (FRED)'
    }
  };

  return res.status(200).json({ success: true, data: aggregated });
}
