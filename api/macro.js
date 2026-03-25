module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const yfChart = async (symbol) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DJAI/1.0)',
          'Accept': 'application/json'
        }
      });
      if (!r.ok) return { price: null, fmt: null, changePct: null, change: null };
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return { price: null, fmt: null, changePct: null, change: null };
      const price = meta.regularMarketPrice ?? null;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      const change = (price != null && prev != null) ? price - prev : null;
      const changePct = (change != null && prev) ? ((change / prev) * 100).toFixed(2) + '%' : null;
      return {
        price,
        fmt: price != null ? price.toFixed(2) : null,
        change,
        changePct
      };
    } catch(e) {
      return { price: null, fmt: null, changePct: null, change: null };
    }
  };

  try {
    const [vix, dxy, oil, t10y] = await Promise.all([
      yfChart('^VIX'),
      yfChart('DX-Y.NYB'),
      yfChart('CL=F'),
      yfChart('^TNX')
    ]);

    // CPI from FRED (fredgraph.json returns a plain array, not { observations: [] })
    let cpiYoy = null;
    try {
      const fredCpi = await fetch(
        'https://fred.stlouisfed.org/graph/fredgraph.json?id=CPIAUCSL',
        { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
      );
      if (fredCpi.ok) {
        const cpiRaw = await fredCpi.json();
        const obs = cpiRaw?.observations || (Array.isArray(cpiRaw) ? cpiRaw : []);
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
        fedFundsRaw: 3.625,
        treasury10y: null, cpiYoy: null,
        vix: null, dxy: null, wtiCrude: null,
        timestamp: new Date().toISOString()
      }
    });
  }
}
