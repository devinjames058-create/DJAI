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
  const HOST = 'yahoo-finance166.p.rapidapi.com';
  const headers = {
    'x-rapidapi-key': RAPID_KEY,
    'x-rapidapi-host': HOST,
    'Content-Type': 'application/json'
  };

  try {
    const [priceRes, statsRes, financialRes] = await Promise.all([
      fetch(`https://${HOST}/api/stock/stockGetPrice?symbol=${encodeURIComponent(ticker)}`, { headers }),
      fetch(`https://${HOST}/api/stock/stockGetStatistics?region=US&symbol=${encodeURIComponent(ticker)}`, { headers }),
      fetch(`https://${HOST}/api/stock/get-financial-data?region=US&symbol=${encodeURIComponent(ticker)}`, { headers })
    ]);

    const [priceJson, statsJson, financialJson] = await Promise.all([
      priceRes.json(), statsRes.json(), financialRes.json()
    ]);

    const p = priceJson?.quoteSummary?.result?.[0]?.price || {};
    const s = statsJson?.quoteSummary?.result?.[0]?.summaryDetail || {};
    const ks = statsJson?.quoteSummary?.result?.[0]?.defaultKeyStatistics || {};
    const f = financialJson?.quoteSummary?.result?.[0]?.financialData || {};

    const marketData = {
      ticker: ticker.toUpperCase(),
      companyName: p.longName || p.shortName || ticker,
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
      marketCap: p.marketCap?.fmt ?? s.marketCap?.fmt ?? null,
      marketCapRaw: p.marketCap?.raw ?? s.marketCap?.raw ?? null,
      pe: s.trailingPE?.fmt ?? p.trailingPE?.fmt ?? null,
      forwardPE: s.forwardPE?.fmt ?? null,
      priceToBook: ks.priceToBook?.fmt ?? null,
      eps: ks.trailingEps?.fmt ?? null,
      week52High: s.fiftyTwoWeekHigh?.fmt ?? null,
      week52Low: s.fiftyTwoWeekLow?.fmt ?? null,
      fiftyDayAvg: s.fiftyDayAverage?.fmt ?? null,
      twoHundredDayAvg: s.twoHundredDayAverage?.fmt ?? null,
      avgVolume: s.averageVolume?.fmt ?? null,
      dividendYield: s.dividendYield?.fmt ?? s.trailingAnnualDividendYield?.fmt ?? null,
      beta: s.beta?.fmt ?? null,
      sharesOutstanding: ks.sharesOutstanding?.fmt ?? null,
      currency: p.currency ?? 'USD',
      exchange: p.exchangeName ?? null,
      revenue: f.totalRevenue?.fmt ?? null,
      revenueRaw: f.totalRevenue?.raw ?? null,
      grossMargin: f.grossMargins?.fmt ?? null,
      operatingMargin: f.operatingMargins?.fmt ?? null,
      profitMargin: f.profitMargins?.fmt ?? null,
      totalCash: f.totalCash?.fmt ?? null,
      totalDebt: f.totalDebt?.fmt ?? null,
      debtToEquity: f.debtToEquity?.fmt ?? null,
      freeCashflow: f.freeCashflow?.fmt ?? null,
      operatingCashflow: f.operatingCashflow?.fmt ?? null,
      returnOnEquity: f.returnOnEquity?.fmt ?? null,
      returnOnAssets: f.returnOnAssets?.fmt ?? null,
      earningsGrowth: f.earningsGrowth?.fmt ?? null,
      revenueGrowth: f.revenueGrowth?.fmt ?? null,
      currentRatio: f.currentRatio?.fmt ?? null,
      quickRatio: f.quickRatio?.fmt ?? null,
      targetMeanPrice: f.targetMeanPrice?.fmt ?? null,
      targetHighPrice: f.targetHighPrice?.fmt ?? null,
      targetLowPrice: f.targetLowPrice?.fmt ?? null,
      recommendationKey: f.recommendationKey ?? null,
      numberOfAnalystOpinions: f.numberOfAnalystOpinions?.raw ?? null,
      dataTimestamp: new Date().toISOString()
    };

    return res.status(200).json({ success: true, data: marketData });
  } catch(e) {
    return res.status(500).json({ error: e.message, success: false });
  }
}
