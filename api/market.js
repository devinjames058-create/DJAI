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

  try {
    // Fetch quote data (price, market cap, P/E, 52w range etc)
    const quoteRes = await fetch(
      `https://${HOST}/api/stock/get-quote?region=US&symbol=${encodeURIComponent(ticker)}`,
      {
        headers: {
          'x-rapidapi-key': RAPID_KEY,
          'x-rapidapi-host': HOST,
          'Content-Type': 'application/json'
        }
      }
    );

    // Fetch financial summary (revenue, earnings, margins)
    const summaryRes = await fetch(
      `https://${HOST}/api/stock/get-financial-data?region=US&symbol=${encodeURIComponent(ticker)}`,
      {
        headers: {
          'x-rapidapi-key': RAPID_KEY,
          'x-rapidapi-host': HOST,
          'Content-Type': 'application/json'
        }
      }
    );

    const quoteData = await quoteRes.json();
    const summaryData = await summaryRes.json();

    // Extract the key metrics from quote response
    const q = quoteData?.quoteSummary?.result?.[0]?.price || {};
    const f = summaryData?.quoteSummary?.result?.[0]?.financialData || {};

    const marketData = {
      ticker: ticker.toUpperCase(),
      companyName: q.longName || q.shortName || ticker,
      price: q.regularMarketPrice?.raw || null,
      priceChange: q.regularMarketChange?.raw || null,
      priceChangePct: q.regularMarketChangePercent?.fmt || null,
      marketCap: q.marketCap?.fmt || null,
      marketCapRaw: q.marketCap?.raw || null,
      pe: q.trailingPE?.fmt || null,
      forwardPE: q.forwardPE?.fmt || null,
      eps: q.epsTrailingTwelveMonths?.fmt || null,
      week52High: q.fiftyTwoWeekHigh?.fmt || null,
      week52Low: q.fiftyTwoWeekLow?.fmt || null,
      avgVolume: q.averageDailyVolume3Month?.fmt || null,
      dividendYield: q.dividendYield?.fmt || null,
      beta: q.beta?.fmt || null,
      currency: q.currency || 'USD',
      exchange: q.exchangeName || null,
      // Financial data
      revenue: f.totalRevenue?.fmt || null,
      revenueRaw: f.totalRevenue?.raw || null,
      grossMargin: f.grossMargins?.fmt || null,
      operatingMargin: f.operatingMargins?.fmt || null,
      profitMargin: f.profitMargins?.fmt || null,
      totalCash: f.totalCash?.fmt || null,
      totalDebt: f.totalDebt?.fmt || null,
      freeCashflow: f.freeCashflow?.fmt || null,
      returnOnEquity: f.returnOnEquity?.fmt || null,
      earningsGrowth: f.earningsGrowth?.fmt || null,
      revenueGrowth: f.revenueGrowth?.fmt || null,
      targetMeanPrice: f.targetMeanPrice?.fmt || null,
      recommendationKey: f.recommendationKey || null,
      numberOfAnalystOpinions: f.numberOfAnalystOpinions?.raw || null,
      dataTimestamp: new Date().toISOString()
    };

    return res.status(200).json({ success: true, data: marketData });

  } catch(e) {
    return res.status(500).json({ error: e.message, success: false });
  }
}
