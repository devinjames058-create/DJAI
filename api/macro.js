module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── Per-symbol Yahoo Finance fetch — returns price, change, changePct + ok flag ──
  const yfChart = async (symbol) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DJAI/1.0)', 'Accept': 'application/json' }
      });
      if (!r.ok) return { price: null, fmt: null, changePct: null, change: null, ok: false };
      const data = await r.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return { price: null, fmt: null, changePct: null, change: null, ok: false };
      const price = meta.regularMarketPrice ?? null;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      const change = (price != null && prev != null) ? price - prev : null;
      const changePct = (change != null && prev) ? ((change / prev) * 100).toFixed(2) + '%' : null;
      const marketState = meta.marketState ?? null; // REGULAR | PRE | POST | CLOSED
      return { price, fmt: price != null ? price.toFixed(2) : null, change, changePct, marketState, ok: price != null };
    } catch(e) {
      return { price: null, fmt: null, changePct: null, change: null, ok: false };
    }
  };

  // ── FRED series fetch — returns latest value and its date ──────────────────
  const fredLatest = async (seriesId) => {
    try {
      const r = await fetch(
        `https://fred.stlouisfed.org/graph/fredgraph.json?id=${seriesId}`,
        { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
      );
      if (!r.ok) return { value: null, date: null, ok: false };
      const raw = await r.json();
      const obs = raw?.observations || (Array.isArray(raw) ? raw : []);
      if (!obs.length) return { value: null, date: null, ok: false };
      const last = obs[obs.length - 1];
      const val = parseFloat(last?.value);
      return { value: isNaN(val) ? null : val, date: last?.date || null, ok: !isNaN(val) };
    } catch(e) {
      return { value: null, date: null, ok: false };
    }
  };

  // ── Fetch all in parallel ──────────────────────────────────────────────────
  const [vixRes, dxyRes, oilRes, t10yRes, fedUpperRes, fedLowerRes, cpiRes] = await Promise.allSettled([
    yfChart('^VIX'),
    yfChart('DX-Y.NYB'),
    yfChart('CL=F'),
    yfChart('^TNX'),
    fredLatest('DFEDTARU'),  // Fed Funds upper target (daily, FOMC)
    fredLatest('DFEDTARL'),  // Fed Funds lower target (daily, FOMC)
    fredLatest('CPIAUCSL'),  // CPI (monthly)
  ]);

  const safe = (settled) => settled.status === 'fulfilled' ? settled.value : { value: null, date: null, ok: false, price: null, fmt: null, changePct: null };
  const vix   = safe(vixRes);
  const dxy   = safe(dxyRes);
  const oil   = safe(oilRes);
  const t10y  = safe(t10yRes);
  const fedU  = safe(fedUpperRes);
  const fedL  = safe(fedLowerRes);
  const cpiRaw = safe(cpiRes);

  // ── Fed Funds Rate — FOMC target range from FRED ───────────────────────────
  let fedFundsRate = null, fedFundsRaw = null, fedFundsAsOf = null;
  if (fedU.ok && fedL.ok) {
    const upper = fedU.value, lower = fedL.value;
    fedFundsRaw  = (upper + lower) / 2;
    fedFundsRate = `${lower.toFixed(2)}–${upper.toFixed(2)}%`;
    fedFundsAsOf = fedU.date || fedL.date || null;
  }

  // ── CPI YoY — need at least 13 months to compute YoY ─────────────────────
  // FRED fredgraph returns one value per call — for YoY we need history.
  // Fetch with longer range via different endpoint format.
  let cpiYoy = null, cpiAsOf = null;
  try {
    const cpiHistRes = await fetch(
      'https://fred.stlouisfed.org/graph/fredgraph.json?id=CPIAUCSL',
      { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
    );
    if (cpiHistRes.ok) {
      const cpiHistRaw = await cpiHistRes.json();
      const obs = cpiHistRaw?.observations || (Array.isArray(cpiHistRaw) ? cpiHistRaw : []);
      if (obs.length >= 13) {
        const latest  = parseFloat(obs[obs.length - 1]?.value);
        const yearAgo = parseFloat(obs[obs.length - 13]?.value);
        if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo > 0) {
          cpiYoy    = (latest - yearAgo) / yearAgo * 100;
          cpiAsOf   = obs[obs.length - 1]?.date || null;
        }
      }
    }
  } catch(e) {}

  const timestamp = new Date().toISOString();

  return res.status(200).json({
    success: true,
    data: {
      // Fed Funds Rate — FOMC target range (FRED DFEDTARU/DFEDTARL, daily)
      fedFundsRate:       fedFundsRate ?? '—',
      fedFundsRaw:        fedFundsRaw,
      fedFundsAsOf:       fedFundsAsOf,
      fedFundsOk:         fedU.ok && fedL.ok,
      fedFundsSource:     'FRED DFEDTARU/DFEDTARL',

      // 10Y Treasury — Yahoo Finance ^TNX (intraday last)
      treasury10y:        t10y.price != null ? t10y.price.toFixed(2) + '%' : null,
      treasury10yRaw:     t10y.price,
      treasury10yChange:  t10y.changePct,
      treasury10yOk:      t10y.ok,
      treasury10ySource:  'Yahoo Finance (^TNX · intraday last)',

      // CPI YoY — FRED CPIAUCSL (monthly, 1-2 month lag)
      cpiYoy:             cpiYoy != null ? cpiYoy.toFixed(1) + '%' : null,
      cpiYoyRaw:          cpiYoy,
      cpiAsOf:            cpiAsOf,
      cpiOk:              cpiYoy != null,
      cpiSource:          'FRED CPIAUCSL (monthly, 1–2mo lag)',

      // VIX — Yahoo Finance ^VIX
      vix:                vix.fmt ?? null,
      vixRaw:             vix.price,
      vixChange:          vix.changePct,
      vixOk:              vix.ok,
      vixSource:          'Yahoo Finance (^VIX · last)',

      // DXY — Yahoo Finance DX-Y.NYB
      dxy:                dxy.fmt ?? null,
      dxyRaw:             dxy.price,
      dxyChange:          dxy.changePct,
      dxyOk:              dxy.ok,
      dxySource:          'Yahoo Finance (DX-Y.NYB · last)',

      // WTI Crude — Yahoo Finance CL=F
      wtiCrude:           oil.price != null ? '$' + Number(oil.price).toFixed(2) : null,
      wtiRaw:             oil.price,
      wtiChange:          oil.changePct,
      wtiOk:              oil.ok,
      wtiSource:          'Yahoo Finance (CL=F · front month)',

      timestamp
    }
  });
}
