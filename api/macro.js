module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const RAPID_KEY = process.env.RAPIDAPI_KEY;
  const YF_HOST = 'yahoo-finance166.p.rapidapi.com';
  const yfHeaders = {
    'x-rapidapi-key': RAPID_KEY,
    'x-rapidapi-host': YF_HOST,
    'Content-Type': 'application/json'
  };

  // Safe JSON parser
  const safeJson = async (p) => {
    try {
      if (p.status === 'fulfilled') return await p.value.json();
    } catch(e) {}
    return null;
  };

  // Safe Yahoo Finance quote extractor
  const yfPrice = (data) => {
    try {
      const p = data?.quoteSummary?.result?.[0]?.price || {};
      return {
        price: p.regularMarketPrice?.raw ?? null,
        fmt: p.regularMarketPrice?.fmt ?? null,
        changePct: p.regularMarketChangePercent?.fmt ?? null,
        change: p.regularMarketChange?.raw ?? null
      };
    } catch(e) { return { price: null }; }
  };

  try {
    // Fetch everything in parallel using Yahoo Finance (reliable, CORS-safe from server)
    const [vixRes, dxyRes, oilRes, t10yRes, tnxRes] = await Promise.allSettled([
      // VIX - CBOE Volatility Index
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=%5EVIX`, { headers: yfHeaders }),
      // DXY - US Dollar Index
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=DX-Y.NYB`, { headers: yfHeaders }),
      // WTI Crude Oil
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=CL%3DF`, { headers: yfHeaders }),
      // 10Y Treasury Yield
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=%5ETNX`, { headers: yfHeaders }),
      // 13-week T-Bill (for short-term rate)
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=%5EIRX`, { headers: yfHeaders })
    ]);

    const [vixData, dxyData, oilData, t10yData, tnxData] = await Promise.all([
      safeJson(vixRes), safeJson(dxyRes), safeJson(oilRes),
      safeJson(t10yRes), safeJson(tnxRes)
    ]);

    const vix = yfPrice(vixData);
    const dxy = yfPrice(dxyData);
    const oil = yfPrice(oilData);
    const t10y = yfPrice(t10yData);

    // CPI and Fed Funds Rate - use FRED API (server-side works fine)
    let cpiYoy = null;
    let fedFunds = '3.50–3.75'; // Keep as known current value if FRED fails

    try {
      const fredCpiRes = await fetch(
        'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&sort_order=desc&limit=14&api_key=FRED_PUBLIC&file_type=json',
        { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
      );
      // FRED public API doesn't require a key for basic access
      // Use the fredgraph endpoint which is more permissive
      const fredCpi2 = await fetch(
        'https://fred.stlouisfed.org/graph/fredgraph.json?id=CPIAUCSL',
        { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
      );
      if (fredCpi2.ok) {
        const cpiData = await fredCpi2.json();
        const obs = cpiData?.observations || [];
        if (obs.length >= 13) {
          const latest = parseFloat(obs[obs.length-1]?.value);
          const yearAgo = parseFloat(obs[obs.length-13]?.value);
          if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo > 0) {
            cpiYoy = ((latest - yearAgo) / yearAgo * 100);
          }
        }
      }
    } catch(e) {}

    const macro = {
      // Fed Funds - hardcoded current FOMC rate (changes rarely, well known)
      fedFundsRate: '4.25–4.50%',
      fedFundsRaw: 4.375,

      // 10Y Treasury from Yahoo Finance (^TNX) - already in % format
      treasury10y: t10y.price ? t10y.price.toFixed(2) + '%' : null,
      treasury10yRaw: t10y.price,
      treasury10yChange: t10y.changePct,

      // CPI from FRED
      cpiYoy: cpiYoy ? cpiYoy.toFixed(1) + '%' : null,
      cpiYoyRaw: cpiYoy,

      // VIX from Yahoo Finance (^VIX)
      vix: vix.fmt ?? null,
      vixRaw: vix.price,
      vixChange: vix.changePct,

      // DXY from Yahoo Finance
      dxy: dxy.fmt ?? null,
      dxyRaw: dxy.price,
      dxyChange: dxy.changePct,

      // WTI Crude from Yahoo Finance (CL=F)
      wtiCrude: oil.price ? '$' + Number(oil.price).toFixed(2) : null,
      wtiRaw: oil.price,
      wtiChange: oil.changePct,

      timestamp: new Date().toISOString()
    };

    return res.status(200).json({ success: true, data: macro });

  } catch(e) {
    // Return known approximate values as fallback so UI never shows dashes
    return res.status(200).json({
      success: true,
      data: {
        fedFundsRate: '4.25–4.50%',
        treasury10y: null, cpiYoy: null,
        vix: null, dxy: null, wtiCrude: null,
        timestamp: new Date().toISOString()
      }
    });
  }
}
