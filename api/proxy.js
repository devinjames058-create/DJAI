<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DJAI — Finance Intelligence</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Playfair+Display:ital,wght@0,500;0,700;1,500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0a0b;
  --surface: #111113;
  --surface2: #18181b;
  --surface3: #222226;
  --border: rgba(255,255,255,0.06);
  --border2: rgba(255,255,255,0.11);
  --gold: #c9a84c;
  --gold2: #e8c97a;
  --gold3: rgba(201,168,76,0.08);
  --text: #e8e6e0;
  --muted: #6a6860;
  --muted2: #9a9890;
  --green: #4caf7d;
  --red: #e05c5c;
  --amber: #e09b3c;
  --blue: #5b8fd4;
  --teal: #4cb8a8;
}

html, body { height: 100%; overflow: hidden; }
body { background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; font-size: 13px; }

/* GRID NOISE BACKGROUND */
body::before {
  content: '';
  position: fixed; inset: 0;
  background-image:
    linear-gradient(rgba(201,168,76,0.015) 1px, transparent 1px),
    linear-gradient(90deg, rgba(201,168,76,0.015) 1px, transparent 1px);
  background-size: 40px 40px;
  pointer-events: none; z-index: 0;
}

/* LAYOUT */
.shell { display: grid; grid-template-rows: 56px 1fr; height: 100vh; position: relative; z-index: 1; }

/* TOPBAR */
.topbar {
  display: flex; align-items: center; gap: 20px;
  padding: 0 28px; border-bottom: 1px solid var(--border);
  background: rgba(10,10,11,0.9); backdrop-filter: blur(12px);
}
.brand { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; color: var(--gold); letter-spacing: 0.04em; flex-shrink: 0; }
.brand-sub { font-family: 'DM Mono', monospace; font-size: 8px; color: var(--muted); letter-spacing: 0.2em; text-transform: uppercase; display: block; margin-top: 1px; }

.search-bar-wrap { flex: 1; max-width: 640px; position: relative; }
.search-bar {
  width: 100%; background: var(--surface2); border: 1px solid var(--border2);
  border-radius: 8px; padding: 9px 40px 9px 14px;
  color: var(--text); font-size: 13px; font-family: 'DM Sans', sans-serif;
  outline: none; transition: border-color .15s;
}
.search-bar:focus { border-color: var(--gold); }
.search-bar::placeholder { color: var(--muted); }
.search-icon { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 14px; pointer-events: none; }
.search-btn {
  background: var(--gold); border: none; border-radius: 7px; padding: 8px 18px;
  color: #0a0a0b; font-size: 12px; font-weight: 500; cursor: pointer;
  font-family: 'DM Sans', sans-serif; white-space: nowrap; transition: background .15s; flex-shrink: 0;
}
.search-btn:hover { background: var(--gold2); }
.search-btn:disabled { background: var(--surface3); color: var(--muted); cursor: not-allowed; }

.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.status-label { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--muted); }

/* MAIN AREA */
.main { display: grid; grid-template-columns: 220px 1fr 260px; overflow: hidden; }

/* LEFT SIDEBAR — history */
.left-sidebar { border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; background: var(--surface); }
.sidebar-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sidebar-title { font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); }
.history-list { flex: 1; overflow-y: auto; padding: 8px; }
.history-item {
  padding: 8px 10px; border-radius: 6px; cursor: pointer;
  transition: background .12s; margin-bottom: 2px;
}
.history-item:hover { background: var(--surface2); }
.history-item.active { background: var(--gold3); border: 1px solid rgba(201,168,76,0.15); }
.history-query { font-size: 12px; color: var(--muted2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history-time { font-family: 'DM Mono', monospace; font-size: 9px; color: var(--muted); margin-top: 2px; }
.history-empty { padding: 20px 16px; font-size: 11px; color: var(--muted); line-height: 1.6; }

/* CENTER — results */
.center { overflow-y: auto; display: flex; flex-direction: column; }

/* LANDING */
.landing {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 60px; gap: 32px;
}
.landing-logo { font-family: 'Playfair Display', serif; font-size: 52px; font-weight: 700; color: var(--gold); letter-spacing: 0.02em; line-height: 1; }
.landing-logo em { font-style: italic; color: var(--gold2); }
.landing-tagline { font-size: 14px; color: var(--muted2); text-align: center; line-height: 1.7; max-width: 480px; }
.quick-searches { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 560px; }
.quick-chip {
  background: var(--surface2); border: 1px solid var(--border2); border-radius: 20px;
  padding: 6px 14px; font-size: 11px; color: var(--muted2); cursor: pointer;
  transition: all .15s; font-family: 'DM Mono', monospace; letter-spacing: 0.03em;
}
.quick-chip:hover { border-color: var(--gold); color: var(--gold); background: var(--gold3); }
.landing-note { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--muted); text-align: center; }

/* RESULTS */
.results { padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; }
.results-header { display: flex; align-items: baseline; gap: 12px; padding-bottom: 4px; }
.results-query { font-family: 'Playfair Display', serif; font-size: 22px; color: var(--text); font-weight: 500; }
.results-meta { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--muted); }

/* CARDS */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  overflow: hidden; animation: fadeUp .25s ease both;
}
@keyframes fadeUp { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: none; } }
.card:nth-child(2) { animation-delay: .05s; }
.card:nth-child(3) { animation-delay: .1s; }
.card:nth-child(4) { animation-delay: .15s; }
.card:nth-child(5) { animation-delay: .2s; }

.card-header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
  background: var(--surface2);
}
.card-icon { font-size: 13px; }
.card-title { font-family: 'DM Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--gold); }
.card-body { padding: 16px; }

/* OVERVIEW CARD */
.overview-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.metric { }
.metric-val { font-family: 'Playfair Display', serif; font-size: 20px; color: var(--text); font-weight: 500; line-height: 1; }
.metric-val.up { color: var(--green); }
.metric-val.down { color: var(--red); }
.metric-label { font-family: 'DM Mono', monospace; font-size: 9px; color: var(--muted); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.08em; }
.metric-sub { font-size: 11px; color: var(--muted2); margin-top: 1px; }

/* THESIS CARD */
.thesis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.thesis-col { }
.thesis-col-label { font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px; }
.thesis-col-label.bull { color: var(--green); }
.thesis-col-label.bear { color: var(--red); }
.thesis-point { display: flex; gap: 8px; margin-bottom: 6px; font-size: 12px; color: var(--muted2); line-height: 1.5; }
.thesis-point::before { content: '▸'; color: var(--muted); flex-shrink: 0; font-size: 10px; margin-top: 2px; }
.thesis-col.bear .thesis-point::before { content: '▾'; }
.thesis-summary { font-size: 12px; color: var(--muted2); line-height: 1.7; padding-top: 12px; border-top: 1px solid var(--border); }

/* NEWS CARD */
.news-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.news-item:last-child { border-bottom: none; padding-bottom: 0; }
.news-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gold); flex-shrink: 0; margin-top: 5px; }
.news-content { flex: 1; }
.news-headline { font-size: 12px; color: var(--text); line-height: 1.5; margin-bottom: 3px; }
.news-meta { font-family: 'DM Mono', monospace; font-size: 9px; color: var(--muted); }

/* COMPS CARD */
.comps-table { width: 100%; border-collapse: collapse; }
.comps-table th { font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); text-align: left; padding: 0 8px 8px 0; }
.comps-table td { font-size: 12px; color: var(--muted2); padding: 6px 8px 6px 0; border-top: 1px solid var(--border); }
.comps-table td:first-child { color: var(--text); font-weight: 500; }
.comps-table td.up { color: var(--green); font-family: 'DM Mono', monospace; }
.comps-table td.down { color: var(--red); font-family: 'DM Mono', monospace; }
.comps-table td.num { font-family: 'DM Mono', monospace; }

/* RISKS CARD */
.risk-item { display: flex; gap: 10px; margin-bottom: 10px; align-items: flex-start; }
.risk-item:last-child { margin-bottom: 0; }
.risk-badge { font-family: 'DM Mono', monospace; font-size: 9px; padding: 2px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.06em; flex-shrink: 0; margin-top: 1px; }
.risk-badge.high { background: rgba(224,92,92,0.15); color: var(--red); }
.risk-badge.med { background: rgba(224,155,60,0.15); color: var(--amber); }
.risk-badge.low { background: rgba(76,175,125,0.15); color: var(--green); }
.risk-text { font-size: 12px; color: var(--muted2); line-height: 1.5; }

/* LOADING */
.loading-state { padding: 48px 28px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.loading-bar { width: 280px; height: 2px; background: var(--surface3); border-radius: 1px; overflow: hidden; }
.loading-fill { height: 100%; background: var(--gold); border-radius: 1px; animation: loadFill 2.5s ease infinite; }
@keyframes loadFill { 0%{width:0%;margin-left:0} 50%{width:80%;margin-left:0} 100%{width:0%;margin-left:100%} }
.loading-label { font-family: 'DM Mono', monospace; font-size: 10px; color: var(--muted); letter-spacing: 0.1em; }
.loading-steps { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.loading-step { font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.loading-step.done { color: var(--green); }
.loading-step.active { color: var(--gold2); }
.step-icon { font-size: 10px; }

/* RIGHT SIDEBAR */
.right-sidebar { border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; background: var(--surface); }
.right-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.right-section { padding: 14px 16px; border-bottom: 1px solid var(--border); }
.right-label { font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); margin-bottom: 10px; }
.ticker-chip { display: inline-block; background: var(--surface2); border: 1px solid var(--border2); border-radius: 5px; padding: 4px 8px; font-family: 'DM Mono', monospace; font-size: 11px; color: var(--gold); margin: 3px; cursor: pointer; transition: all .12s; }
.ticker-chip:hover { border-color: var(--gold); background: var(--gold3); }
.macro-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.macro-label { font-size: 11px; color: var(--muted2); }
.macro-val { font-family: 'DM Mono', monospace; font-size: 11px; color: var(--text); }
.macro-val.up { color: var(--green); }
.macro-val.down { color: var(--red); }
.ask-input-wrap { padding: 14px 16px; }
.ask-input { width: 100%; background: var(--surface2); border: 1px solid var(--border2); border-radius: 6px; padding: 8px 10px; color: var(--text); font-size: 11px; font-family: 'DM Sans', sans-serif; outline: none; resize: none; min-height: 64px; }
.ask-input:focus { border-color: var(--gold); }
.ask-btn { margin-top: 8px; width: 100%; background: var(--surface3); border: 1px solid var(--border2); border-radius: 6px; padding: 8px; font-size: 11px; color: var(--muted2); cursor: pointer; font-family: 'DM Sans', sans-serif; transition: all .15s; }
.ask-btn:hover { border-color: var(--gold); color: var(--gold); }
.followup-result { margin-top: 10px; font-size: 11px; color: var(--muted2); line-height: 1.65; white-space: pre-wrap; }

::-webkit-scrollbar { width: 3px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

/* TOAST */
.toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--surface3); border: 1px solid var(--border2); border-radius: 8px; padding: 9px 18px; font-size: 12px; color: var(--text); z-index: 999; opacity: 0; transition: opacity .2s; pointer-events: none; white-space: nowrap; }
.toast.show { opacity: 1; }
</style>
</head>
<body>

<div class="shell">
  <!-- TOPBAR -->
  <div class="topbar">
    <div>
      <div class="brand">DJAI</div>
      <span class="brand-sub">Finance Intelligence</span>
    </div>
    <div class="search-bar-wrap">
      <input class="search-bar" id="main-search" placeholder="Search any ticker, company, deal, theme, person..." onkeydown="if(event.key==='Enter') runSearch()">
      <span class="search-icon">⌕</span>
    </div>
    <button class="search-btn" id="search-btn" onclick="runSearch()">Search</button>
    <div class="topbar-right">
      <div class="status-dot"></div>
      <span class="status-label">LIVE</span>
    </div>
  </div>

  <div class="main">
    <!-- LEFT SIDEBAR -->
    <div class="left-sidebar">
      <div class="sidebar-head">
        <div class="sidebar-title">Search History</div>
      </div>
      <div class="history-list" id="history-list">
        <div class="history-empty">Your searches will appear here.</div>
      </div>
    </div>

    <!-- CENTER -->
    <div class="center" id="center">
      <div id="results-container" style="display:none"></div>
      <!-- LANDING -->
      <div class="landing" id="landing">
        <div>
          <div class="landing-logo">DJ<em>AI</em></div>
        </div>
        <p class="landing-tagline">Bloomberg-grade financial intelligence powered by AI. Search any ticker, company, deal structure, macro theme, or person in finance.</p>
        <div class="quick-searches">
          <div class="quick-chip" onclick="quickSearch('NVDA')">NVDA</div>
          <div class="quick-chip" onclick="quickSearch('BlackRock')">BlackRock</div>
          <div class="quick-chip" onclick="quickSearch('Fed rate cuts 2025')">Fed rate cuts</div>
          <div class="quick-chip" onclick="quickSearch('multifamily real estate outlook')">Multifamily RE</div>
          <div class="quick-chip" onclick="quickSearch('Apollo Global Management')">Apollo</div>
          <div class="quick-chip" onclick="quickSearch('private credit market')">Private credit</div>
          <div class="quick-chip" onclick="quickSearch('S&P 500 valuation')">S&P 500</div>
          <div class="quick-chip" onclick="quickSearch('Goldman Sachs AWM')">GS AWM</div>
        </div>
        <div class="landing-note">Powered by Claude + live web search · Built by Devin-James Skerritt</div>
      </div>
    </div>

    <!-- RIGHT SIDEBAR -->
    <div class="right-sidebar">
      <div class="right-head">
        <div class="sidebar-title">Market Pulse</div>
      </div>
      <div class="right-section">
        <div class="right-label">Watchlist</div>
        <div id="watchlist-chips">
          <span class="ticker-chip" onclick="quickSearch('SPY')">SPY</span>
          <span class="ticker-chip" onclick="quickSearch('QQQ')">QQQ</span>
          <span class="ticker-chip" onclick="quickSearch('BLK')">BLK</span>
          <span class="ticker-chip" onclick="quickSearch('GS')">GS</span>
          <span class="ticker-chip" onclick="quickSearch('BX')">BX</span>
          <span class="ticker-chip" onclick="quickSearch('APO')">APO</span>
          <span class="ticker-chip" onclick="quickSearch('KKR')">KKR</span>
          <span class="ticker-chip" onclick="quickSearch('ARES')">ARES</span>
        </div>
      </div>
      <div class="right-section">
        <div class="right-label">Macro Indicators</div>
        <div class="macro-item"><span class="macro-label">Fed Funds Rate</span><span class="macro-val">4.25–4.50%</span></div>
        <div class="macro-item"><span class="macro-label">10Y Treasury</span><span class="macro-val up">4.31%</span></div>
        <div class="macro-item"><span class="macro-label">CPI (YoY)</span><span class="macro-val down">2.8%</span></div>
        <div class="macro-item"><span class="macro-label">VIX</span><span class="macro-val">18.4</span></div>
        <div class="macro-item"><span class="macro-label">DXY</span><span class="macro-val down">103.2</span></div>
        <div class="macro-item"><span class="macro-label">WTI Crude</span><span class="macro-val">$67.40</span></div>
      </div>
      <div class="right-section">
        <div class="right-label">Ask a follow-up</div>
      </div>
      <div class="ask-input-wrap">
        <textarea class="ask-input" id="ask-input" placeholder="Ask anything about your last search..."></textarea>
        <button class="ask-btn" onclick="askFollowUp()">Ask Claude ✦</button>
        <div class="followup-result" id="followup-result"></div>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// API calls routed through Vercel proxy at /api/proxy

let searchHistory = [];
let currentQuery = '';
let lastResultContext = '';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function quickSearch(q) {
  document.getElementById('main-search').value = q;
  runSearch();
}

function addToHistory(query) {
  searchHistory.unshift({ query, time: new Date() });
  if (searchHistory.length > 20) searchHistory.pop();
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('history-list');
  if (searchHistory.length === 0) {
    el.innerHTML = '<div class="history-empty">Your searches will appear here.</div>';
    return;
  }
  el.innerHTML = searchHistory.map((h, i) => {
    const mins = Math.floor((new Date() - h.time) / 60000);
    const timeLabel = mins === 0 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    return `<div class="history-item ${i===0?'active':''}" onclick="quickSearch('${h.query.replace(/'/g,"\\'")}')">
      <div class="history-query">${h.query}</div>
      <div class="history-time">${timeLabel}</div>
    </div>`;
  }).join('');
}

function showLoading(query) {
  document.getElementById('landing').style.display = 'none';
  const resultsDiv = document.getElementById('results-container');
  resultsDiv.innerHTML = `
    <div class="loading-state">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:8px">Analyzing "${query}"</div>
      <div class="loading-bar"><div class="loading-fill"></div></div>
      <div class="loading-steps">
        <div class="loading-step active"><span class="step-icon">◈</span> Searching live market data & news</div>
        <div class="loading-step"><span class="step-icon">◈</span> Running analyst thesis generation</div>
        <div class="loading-step"><span class="step-icon">◈</span> Pulling comps & sector context</div>
        <div class="loading-step"><span class="step-icon">◈</span> Compiling risk assessment</div>
      </div>
    </div>`;
  resultsDiv.style.display = 'block';
}

async function runSearch() {
  const query = document.getElementById('main-search').value.trim();
  if (!query) { showToast('Enter a search query'); return; }
  currentQuery = query;
  const btn = document.getElementById('search-btn');
  btn.disabled = true; btn.textContent = 'Searching...';
  showLoading(query);
  addToHistory(query);

  const systemPrompt = `You are DJAI, an elite financial intelligence engine — Bloomberg Terminal meets elite sell-side analyst. You have access to deep market knowledge and provide institutional-grade analysis.

When given a search query, return a JSON object with this exact structure:
{
  "type": "stock" | "company" | "theme" | "person" | "deal" | "general",
  "title": "Display title for the search result",
  "overview": {
    "description": "2-3 sentence description of what this is",
    "metrics": [
      {"label": "metric name", "value": "value string", "change": "+X.X% / null", "direction": "up|down|neutral"}
    ]
  },
  "thesis": {
    "bull": ["point 1", "point 2", "point 3"],
    "bear": ["point 1", "point 2", "point 3"],
    "summary": "2-3 sentence balanced analyst summary with a directional lean"
  },
  "news": [
    {"headline": "headline text", "source": "Source Name", "time": "X days ago", "sentiment": "positive|negative|neutral"}
  ],
  "comps": [
    {"name": "Company/Entity", "metric1": "value", "metric2": "value", "metric3": "value", "change": "+X.X%", "direction": "up|down"}
  ],
  "compsHeaders": ["Name", "Header2", "Header3", "Header4", "Chg"],
  "risks": [
    {"level": "high|med|low", "text": "Risk description"}
  ],
  "context": "A comprehensive 3-4 sentence paragraph with deeper analysis, historical context, and forward-looking insight. This will be used to answer follow-up questions."
}

Use real, accurate financial data and knowledge. For stocks, include real metrics. For themes, adapt the structure to fit. Always return valid JSON only, no markdown, no preamble.`;

  try {
    const res = await fetch('https://djai.vercel.app/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [
          { role: 'user', content: `Search query: "${query}"\n\nUsing your knowledge up to your training cutoff, return the JSON analysis object as specified. Be as accurate and detailed as possible with real data. Today is ${new Date().toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'})}.` }
        ],
        system: systemPrompt
      })
    });

    const data = await res.json();

    // Extract text content from response (may include tool use blocks)
    let rawText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') rawText += block.text;
    }

    // Parse JSON — strip markdown fences first, then extract object
    let result;
    try {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    } catch(e) {
      renderError(query, 'Could not parse AI response. Raw: ' + rawText.slice(0, 200));
      return;
    }

    lastResultContext = result.context || '';
    renderResults(query, result);

  } catch(e) {
    renderError(query, e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Search';
  }
}

function renderResults(query, r) {
  const center = document.getElementById('results-container');

  const metricsHTML = (r.overview?.metrics || []).map(m => `
    <div class="metric">
      <div class="metric-val ${m.direction === 'up' ? 'up' : m.direction === 'down' ? 'down' : ''}">${m.value}</div>
      <div class="metric-label">${m.label}</div>
      ${m.change ? `<div class="metric-sub" style="color:${m.direction==='up'?'var(--green)':m.direction==='down'?'var(--red)':'var(--muted2)'}">${m.change}</div>` : ''}
    </div>`).join('');

  const bullHTML = (r.thesis?.bull || []).map(p => `<div class="thesis-point">${p}</div>`).join('');
  const bearHTML = (r.thesis?.bear || []).map(p => `<div class="thesis-point">${p}</div>`).join('');

  const newsHTML = (r.news || []).map(n => `
    <div class="news-item">
      <div class="news-dot" style="background:${n.sentiment==='positive'?'var(--green)':n.sentiment==='negative'?'var(--red)':'var(--gold)'}"></div>
      <div class="news-content">
        <div class="news-headline">${n.headline}</div>
        <div class="news-meta">${n.source} · ${n.time}</div>
      </div>
    </div>`).join('');

  const compsHeaders = r.compsHeaders || ['Name', 'Metric 1', 'Metric 2', 'Metric 3', 'Chg'];
  const compsHeadHTML = compsHeaders.map(h => `<th>${h}</th>`).join('');
  const compsRowHTML = (r.comps || []).map(c => `
    <tr>
      <td>${c.name}</td>
      <td class="num">${c.metric1 || '—'}</td>
      <td class="num">${c.metric2 || '—'}</td>
      <td class="num">${c.metric3 || '—'}</td>
      <td class="${c.direction === 'up' ? 'up' : 'down'}">${c.change || '—'}</td>
    </tr>`).join('');

  const risksHTML = (r.risks || []).map(rk => `
    <div class="risk-item">
      <span class="risk-badge ${rk.level}">${rk.level}</span>
      <div class="risk-text">${rk.text}</div>
    </div>`).join('');

  center.innerHTML = `
    <div class="results">
      <div class="results-header">
        <div class="results-query">${r.title || query}</div>
        <div class="results-meta">AI analysis · ${new Date().toLocaleDateString()}</div>
      </div>

      ${metricsHTML ? `
      <div class="card" style="animation-delay:.0s">
        <div class="card-header"><span class="card-icon">◈</span><span class="card-title">Overview</span></div>
        <div class="card-body">
          <p style="font-size:12px;color:var(--muted2);line-height:1.7;margin-bottom:14px">${r.overview?.description || ''}</p>
          <div class="overview-grid">${metricsHTML}</div>
        </div>
      </div>` : ''}

      ${bullHTML || bearHTML ? `
      <div class="card">
        <div class="card-header"><span class="card-icon">◈</span><span class="card-title">Analyst Thesis</span></div>
        <div class="card-body">
          <div class="thesis-grid">
            <div class="thesis-col">
              <div class="thesis-col-label bull">Bull Case</div>
              ${bullHTML}
            </div>
            <div class="thesis-col bear">
              <div class="thesis-col-label bear">Bear Case</div>
              ${bearHTML}
            </div>
          </div>
          <div class="thesis-summary">${r.thesis?.summary || ''}</div>
        </div>
      </div>` : ''}

      ${newsHTML ? `
      <div class="card">
        <div class="card-header"><span class="card-icon">◈</span><span class="card-title">Recent News & Catalysts</span></div>
        <div class="card-body">${newsHTML}</div>
      </div>` : ''}

      ${compsRowHTML ? `
      <div class="card">
        <div class="card-header"><span class="card-icon">◈</span><span class="card-title">Comps & Sector Peers</span></div>
        <div class="card-body">
          <table class="comps-table">
            <thead><tr>${compsHeadHTML}</tr></thead>
            <tbody>${compsRowHTML}</tbody>
          </table>
        </div>
      </div>` : ''}

      ${risksHTML ? `
      <div class="card">
        <div class="card-header"><span class="card-icon">◈</span><span class="card-title">Key Risks</span></div>
        <div class="card-body">${risksHTML}</div>
      </div>` : ''}
    </div>`;
}

function renderError(query, detail) {
  const center = document.getElementById('results-container');
  center.innerHTML = `
    <div class="results">
      <div class="results-header">
        <div class="results-query">${query}</div>
        <div class="results-meta" style="color:var(--red)">Error</div>
      </div>
      <div class="card">
        <div class="card-body">
          <p style="font-size:12px;color:var(--muted2);line-height:1.7">Could not retrieve results. Check your API key and try again.<br><span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted)">${detail || ''}</span></p>
        </div>
      </div>
    </div>`;
  // btn reset handled by finally block in runSearch
}

async function askFollowUp() {
  const question = document.getElementById('ask-input').value.trim();
  if (!question) return;
  if (!currentQuery) { showToast('Run a search first'); return; }

  const resultEl = document.getElementById('followup-result');
  resultEl.textContent = 'Thinking...';
  resultEl.style.color = 'var(--muted)';

  try {
    const res = await fetch('https://djai.vercel.app/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Context: The user just searched for "${currentQuery}" on a financial intelligence platform. Here is the analysis context: ${lastResultContext}\n\nFollow-up question: ${question}\n\nAnswer concisely and precisely, like an elite analyst. 2-4 sentences max unless a list is warranted.`
        }],
        system: 'You are DJAI, an elite financial intelligence engine. Answer follow-up questions concisely, precisely, and with institutional-grade insight. No fluff.'
      })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === 'text')?.text || 'No response.';
    resultEl.textContent = text;
    resultEl.style.color = 'var(--muted2)';
    document.getElementById('ask-input').value = '';
  } catch(e) {
    resultEl.textContent = 'Error: ' + e.message;
    resultEl.style.color = 'var(--red)';
  }
}

// Enter key on follow-up
document.getElementById('ask-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askFollowUp(); }
});
</script>
</body>
</html>
