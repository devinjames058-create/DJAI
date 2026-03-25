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

  const safeJson = async (p) => {
    try {
      if (p.status === 'fulfilled') return await p.value.json();
    } catch(e) {}
    return null;
  };

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
    // Fetch VIX, DXY, WTI Crude, 10Y Treasury from Yahoo Finance get-price
    const [vixRes, dxyRes, oilRes, tnxRes] = await Promise.allSettled([
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=${encodeURIComponent('^VIX')}`, { headers: yfHeaders }),
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=${encodeURIComponent('DX-Y.NYB')}`, { headers: yfHeaders }),
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=${encodeURIComponent('CL=F')}`, { headers: yfHeaders }),
      fetch(`https://${YF_HOST}/api/stock/get-price?region=US&symbol=${encodeURIComponent('^TNX')}`, { headers: yfHeaders })
    ]);

    const [vixData, dxyData, oilData, tnxData] = await Promise.all([
      safeJson(vixRes), safeJson(dxyRes), safeJson(oilRes), safeJson(tnxRes)
    ]);

    const vix = yfPrice(vixData);
    const dxy = yfPrice(dxyData);
    const oil = yfPrice(oilData);
    const t10y = yfPrice(tnxData);

    // CPI from FRED (no API key required on fredgraph endpoint)
    let cpiYoy = null;
    try {
      const fredCpi = await fetch(
        'https://fred.stlouisfed.org/graph/fredgraph.json?id=CPIAUCSL',
        { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
      );
      if (fredCpi.ok) {
        const cpiData = await fredCpi.json();
        const obs = cpiData?.observations || [];
        if (obs.length >= 13) {
          const latest = parseFloat(obs[obs.length - 1]?.value);
          const yearAgo = parseFloat(obs[obs.length - 13]?.value);
          if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo > 0) {
            cpiYoy = ((latest - yearAgo) / yearAgo * 100);
          }
        }
      }
    } catch(e) {}

    return res.status(200).json({
      success: true,
      data: {
        fedFundsRate: '3.50–3.75%',
        fedFundsRaw: 3.625,

        treasury10y: t10y.price ? t10y.price.toFixed(2) + '%' : null,
        treasury10yRaw: t10y.price,
        treasury10yChange: t10y.changePct,

        cpiYoy: cpiYoy ? cpiYoy.toFixed(1) + '%' : null,
        cpiYoyRaw: cpiYoy,

        vix: vix.fmt ?? null,
        vixRaw: vix.price,
        vixChange: vix.changePct,

        dxy: dxy.fmt ?? null,
        dxyRaw: dxy.price,
        dxyChange: dxy.changePct,

        wtiCrude: oil.price ? '$' + Number(oil.price).toFixed(2) : null,
        wtiRaw: oil.price,
        wtiChange: oil.changePct,

        timestamp: new Date().toISOString()
      }
    });

  } catch(e) {
    return res.status(200).json({
      success: true,
      data: {
        fedFundsRate: '3.50–3.75%',
        treasury10y: null, cpiYoy: null,
        vix: null, dxy: null, wtiCrude: null,
        timestamp: new Date().toISOString()
      }
    });
  }
}
