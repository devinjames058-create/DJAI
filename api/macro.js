module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const AV_KEY = process.env.ALPHA_VANTAGE_KEY;

  try {
    // Fetch all macro data in parallel from free sources
    const [
      fedFundsRes,  // FRED - Fed Funds Rate
      treasury10yRes, // FRED - 10Y Treasury
      cpiRes,       // FRED - CPI YoY
      vixRes,       // Alpha Vantage - VIX
      dxyRes,       // Alpha Vantage - DXY (USD Index)
      oilRes        // Alpha Vantage - WTI Crude
    ] = await Promise.allSettled([
      fetch('https://fred.stlouisfed.org/graph/fredgraph.json?id=FEDFUNDS', {
        headers: { 'User-Agent': 'DJAI Finance dev@djai.app' }
      }),
      fetch('https://fred.stlouisfed.org/graph/fredgraph.json?id=DGS10', {
        headers: { 'User-Agent': 'DJAI Finance dev@djai.app' }
      }),
      fetch('https://fred.stlouisfed.org/graph/fredgraph.json?id=CPIAUCSL', {
        headers: { 'User-Agent': 'DJAI Finance dev@djai.app' }
      }),
      fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=VIX&apikey=${AV_KEY}`),
      fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=DX-Y.NYB&apikey=${AV_KEY}`),
      fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=USOIL&apikey=${AV_KEY}`)
    ]);

    const safeJson = async (settled) => {
      try {
        if (settled.status === 'fulfilled') return await settled.value.json();
      } catch(e) {}
      return null;
    };

    const [fedData, t10yData, cpiData, vixData, dxyData, oilData] = await Promise.all([
      safeJson(fedFundsRes), safeJson(treasury10yRes), safeJson(cpiRes),
      safeJson(vixRes), safeJson(dxyRes), safeJson(oilRes)
    ]);

    // Extract FRED values (last observation)
    const fredVal = (data) => {
      try {
        const obs = data?.observations || [];
        const latest = obs.filter(o => o.value !== '.' && o.value !== '').pop();
        return latest ? parseFloat(latest.value) : null;
      } catch(e) { return null; }
    };

    // Extract Alpha Vantage global quote
    const avQuote = (data) => {
      try {
        const q = data?.['Global Quote'] || {};
        return {
          price: parseFloat(q['05. price']) || null,
          change: parseFloat(q['09. change']) || null,
          changePct: q['10. change percent'] || null
        };
      } catch(e) { return { price: null }; }
    };

    const fedFunds = fredVal(fedData);
    const treasury10y = fredVal(t10yData);

    // Calculate CPI YoY from FRED monthly data
    let cpiYoy = null;
    try {
      const cpiObs = cpiData?.observations?.filter(o => o.value !== '.' && o.value !== '') || [];
      if (cpiObs.length >= 13) {
        const latest = parseFloat(cpiObs[cpiObs.length - 1].value);
        const yearAgo = parseFloat(cpiObs[cpiObs.length - 13].value);
        cpiYoy = ((latest - yearAgo) / yearAgo * 100);
      }
    } catch(e) {}

    const vix = avQuote(vixData);
    const dxy = avQuote(dxyData);
    const oil = avQuote(oilData);

    // Build response with fallbacks to known approximate values if API fails
    const macro = {
      fedFundsRate: fedFunds ? fedFunds.toFixed(2) + '%' : '4.25–4.50%',
      fedFundsRaw: fedFunds,
      treasury10y: treasury10y ? treasury10y.toFixed(2) + '%' : null,
      treasury10yRaw: treasury10y,
      cpiYoy: cpiYoy ? cpiYoy.toFixed(1) + '%' : null,
      cpiYoyRaw: cpiYoy,
      vix: vix.price ? vix.price.toFixed(2) : null,
      vixChange: vix.changePct || null,
      dxy: dxy.price ? dxy.price.toFixed(2) : null,
      dxyChange: dxy.changePct || null,
      wtiCrude: oil.price ? '$' + oil.price.toFixed(2) : null,
      wtiChange: oil.changePct || null,
      timestamp: new Date().toISOString()
    };

    return res.status(200).json({ success: true, data: macro });

  } catch(e) {
    return res.status(500).json({ error: e.message, success: false });
  }
}
