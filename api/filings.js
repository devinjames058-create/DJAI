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

    // Extract domestic (10-K, 10-Q, 8-K) and foreign private issuer (20-F, 6-K) filings
    const filings = [];
    for (let i = 0; i < forms.length && filings.length < 20; i++) {
      const form = forms[i];
      if (['10-K', '10-Q', '8-K', '20-F', '6-K'].includes(form)) {
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
    // US GAAP filers use 'us-gaap'; foreign private issuers (IFRS) use 'ifrs-full'
    const facts = factsData?.facts?.['us-gaap'] || factsData?.facts?.['ifrs-full'] || {};
    const isForeignFiler = filings.some(f => f.form === '20-F');
    // Annual report form type varies: 10-K for domestic, 20-F for foreign issuers
    const annualFormTypes = ['10-K', '20-F'];

    // Extract key financial metrics from XBRL data
    const getLatestAnnual = (concept) => {
      const data = facts[concept]?.units?.USD;
      if (!data) return null;
      const annual = data.filter(d => annualFormTypes.includes(d.form) && d.val != null)
        .sort((a, b) => new Date(b.end) - new Date(a.end));
      return annual.slice(0, 4).map(d => ({ value: d.val, period: d.end, filed: d.filed }));
    };

    // IFRS-full uses different concept names than US-GAAP for many metrics.
    // Each line tries US-GAAP name first, then IFRS-full equivalent as fallback.
    const financials = {
      // Income Statement
      revenue: getLatestAnnual('Revenues')
        || getLatestAnnual('RevenueFromContractWithCustomerExcludingAssessedTax')
        || getLatestAnnual('SalesRevenueNet')
        || getLatestAnnual('Revenue'),                                    // ifrs-full
      grossProfit: getLatestAnnual('GrossProfit'),                        // same in both
      operatingIncome: getLatestAnnual('OperatingIncomeLoss')
        || getLatestAnnual('ProfitLossFromOperatingActivities'),          // ifrs-full
      netIncome: getLatestAnnual('NetIncomeLoss')
        || getLatestAnnual('ProfitLoss'),                                 // ifrs-full
      ebitda: getLatestAnnual('OperatingIncomeLoss')
        || getLatestAnnual('ProfitLossFromOperatingActivities'),          // approximation
      eps: getLatestAnnual('EarningsPerShareBasic')
        || getLatestAnnual('BasicEarningsLossPerShare'),                  // ifrs-full
      eps_diluted: getLatestAnnual('EarningsPerShareDiluted')
        || getLatestAnnual('DilutedEarningsLossPerShare'),                // ifrs-full
      // Balance Sheet
      totalAssets: getLatestAnnual('Assets'),                            // same in both
      totalLiabilities: getLatestAnnual('Liabilities'),                  // same in both
      stockholderEquity: getLatestAnnual('StockholdersEquity')
        || getLatestAnnual('Equity'),                                     // ifrs-full
      cashAndEquivalents: getLatestAnnual('CashAndCashEquivalentsAtCarryingValue')
        || getLatestAnnual('CashAndCashEquivalents'),                     // ifrs-full
      longTermDebt: getLatestAnnual('LongTermDebt')
        || getLatestAnnual('NoncurrentLiabilities')
        || getLatestAnnual('LongtermBorrowings'),                         // ifrs-full
      // Cash Flow
      operatingCashflow: getLatestAnnual('NetCashProvidedByUsedInOperatingActivities')
        || getLatestAnnual('CashFlowsFromUsedInOperatingActivities'),     // ifrs-full
      capex: getLatestAnnual('PaymentsToAcquirePropertyPlantAndEquipment')
        || getLatestAnnual('PurchaseOfPropertyPlantAndEquipment'),        // ifrs-full
      dividendsPaid: getLatestAnnual('PaymentsOfDividends')
        || getLatestAnnual('DividendsPaid'),                              // ifrs-full
    };

    return res.status(200).json({
      success: true,
      ticker: ticker.toUpperCase(),
      cik,
      companyName,
      isForeignFiler,
      filings,
      financials
    });

  } catch(e) {
    return res.status(500).json({ error: e.message, success: false });
  }
}
