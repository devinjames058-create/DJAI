// SEC EDGAR filings API — no key required, completely free
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }

  const { ticker } = body || {};
  if (!ticker) return res.status(400).json({ error: 'No ticker provided' });

  try {
    // Step 1: Get CIK number from ticker
    const cikRes = await fetch(
      `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=2020-01-01&forms=10-K`,
      { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
    );

    // Use the ticker lookup endpoint
    const tickerMapRes = await fetch(
      'https://www.sec.gov/files/company_tickers.json',
      { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
    );
    const tickerMap = await tickerMapRes.json();

    // Find CIK for ticker
    let cik = null;
    let companyName = null;
    for (const key of Object.keys(tickerMap)) {
      if (tickerMap[key].ticker === ticker.toUpperCase()) {
        cik = String(tickerMap[key].cik_str).padStart(10, '0');
        companyName = tickerMap[key].title;
        break;
      }
    }

    if (!cik) return res.status(404).json({ error: `No SEC filing found for ${ticker}` });

    // Step 2: Get recent filings
    const filingsRes = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
    );
    const filingsData = await filingsRes.json();

    const recent = filingsData.filings?.recent || {};
    const forms = recent.form || [];
    const dates = recent.filingDate || [];
    const accNums = recent.accessionNumber || [];
    const primaryDocs = recent.primaryDocument || [];
    const descriptions = recent.primaryDocDescription || [];

    // Extract 10-K, 10-Q, 8-K filings
    const filings = [];
    for (let i = 0; i < forms.length && filings.length < 20; i++) {
      const form = forms[i];
      if (['10-K', '10-Q', '8-K'].includes(form)) {
        const accNum = accNums[i].replace(/-/g, '');
        const primaryDoc = primaryDocs[i];
        const viewerUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik)}/${accNum}/${primaryDoc}`;
        const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${form}&dateb=&owner=include&count=10`;
        filings.push({
          form,
          date: dates[i],
          accessionNumber: accNums[i],
          description: descriptions[i] || form,
          url: viewerUrl,
          edgarUrl
        });
      }
    }

    // Step 3: Get financial facts (income statement, balance sheet, cash flow)
    const factsRes = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      { headers: { 'User-Agent': 'DJAI Finance dev@djai.app' } }
    );
    const factsData = await factsRes.json();
    const facts = factsData?.facts?.['us-gaap'] || {};

    // Extract key financial metrics from XBRL data
    const getLatestAnnual = (concept) => {
      const data = facts[concept]?.units?.USD;
      if (!data) return null;
      const annual = data.filter(d => d.form === '10-K' && d.val != null)
        .sort((a, b) => new Date(b.end) - new Date(a.end));
      return annual.slice(0, 4).map(d => ({ value: d.val, period: d.end, filed: d.filed }));
    };

    const financials = {
      // Income Statement
      revenue: getLatestAnnual('Revenues') || getLatestAnnual('RevenueFromContractWithCustomerExcludingAssessedTax') || getLatestAnnual('SalesRevenueNet'),
      grossProfit: getLatestAnnual('GrossProfit'),
      operatingIncome: getLatestAnnual('OperatingIncomeLoss'),
      netIncome: getLatestAnnual('NetIncomeLoss'),
      ebitda: getLatestAnnual('OperatingIncomeLoss'), // approximation
      eps: getLatestAnnual('EarningsPerShareBasic'),
      eps_diluted: getLatestAnnual('EarningsPerShareDiluted'),
      // Balance Sheet
      totalAssets: getLatestAnnual('Assets'),
      totalLiabilities: getLatestAnnual('Liabilities'),
      stockholderEquity: getLatestAnnual('StockholdersEquity'),
      cashAndEquivalents: getLatestAnnual('CashAndCashEquivalentsAtCarryingValue'),
      longTermDebt: getLatestAnnual('LongTermDebt'),
      // Cash Flow
      operatingCashflow: getLatestAnnual('NetCashProvidedByUsedInOperatingActivities'),
      capex: getLatestAnnual('PaymentsToAcquirePropertyPlantAndEquipment'),
      dividendsPaid: getLatestAnnual('PaymentsOfDividends'),
    };

    return res.status(200).json({
      success: true,
      ticker: ticker.toUpperCase(),
      cik,
      companyName,
      filings,
      financials
    });

  } catch(e) {
    return res.status(500).json({ error: e.message, success: false });
  }
}
