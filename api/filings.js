const USER_AGENT = 'DJAI Finance dev@djai.app';
const TICKER_INDEX_URL = 'https://www.sec.gov/files/company_tickers.json';
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

function _normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase().replace(/[.\-]/g, '');
}

function _normalizeAccession(accession) {
  return String(accession || '').replace(/-/g, '').trim();
}

function _safeDateValue(value) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : 0;
}

function _escapeCsv(value) {
  const text = value == null ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function _buildCsv(ticker, rows) {
  const headers = [
    'ticker',
    'fiscalYear',
    'field',
    'canonicalValue',
    'filingEvidenceValue',
    'chosenValue',
    'source',
    'accession',
    'filedDate',
    'confidence',
    'warning',
  ];
  const lines = [headers.join(',')];
  for (const row of rows || []) {
    const values = [
      ticker || '',
      row.fiscalYear,
      row.field,
      row.canonicalValue,
      row.filingEvidenceValue,
      row.chosenValue,
      row.source,
      row.accession,
      row.filedDate,
      row.confidence,
      row.warning,
    ].map(_escapeCsv);
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

async function _secFetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error('SEC HTTP ' + res.status);
  return res.json();
}

async function _resolveTicker(ticker) {
  const raw = await _secFetchJson(TICKER_INDEX_URL);
  const normalized = _normalizeTicker(ticker);
  for (const entry of Object.values(raw || {})) {
    if (_normalizeTicker(entry.ticker) !== normalized) continue;
    return {
      cik: String(entry.cik_str || entry.cik).padStart(10, '0'),
      companyName: entry.title || entry.ticker,
      ticker: entry.ticker,
    };
  }
  return null;
}

function _archiveBase(cik, accession) {
  const normalizedAccession = _normalizeAccession(accession);
  if (!normalizedAccession) return null;
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${normalizedAccession}`;
}

function _buildAnnualFilings(submissions, cik) {
  const recent = submissions && submissions.filings && submissions.filings.recent ? submissions.filings.recent : {};
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const accessions = recent.accessionNumber || [];
  const primaryDocs = recent.primaryDocument || [];
  const descriptions = recent.primaryDocDescription || [];
  const out = [];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!ANNUAL_FORMS.has(form)) continue;
    const accessionNumber = accessions[i] || null;
    const filedDate = filingDates[i] || null;
    const reportDate = reportDates[i] || null;
    const primaryDocument = primaryDocs[i] || null;
    const base = _archiveBase(cik, accessionNumber);
    out.push({
      form,
      accessionNumber,
      accession: _normalizeAccession(accessionNumber),
      filedDate,
      filed: filedDate,
      date: filedDate,
      reportDate,
      description: descriptions[i] || form,
      primaryDocumentPath: (base && primaryDocument) ? `${base}/${primaryDocument}` : null,
      filingIndexUrl: base ? `${base}/index.json` : null,
      documents: [],
    });
  }

  out.sort((a, b) => {
    const filedDiff = _safeDateValue(b.filedDate) - _safeDateValue(a.filedDate);
    if (filedDiff !== 0) return filedDiff;
    return _safeDateValue(b.reportDate) - _safeDateValue(a.reportDate);
  });

  return out.slice(0, 8);
}

async function _attachDocuments(filings) {
  return Promise.all((filings || []).map(async (filing) => {
    if (!filing || !filing.filingIndexUrl) return filing;
    try {
      const json = await _secFetchJson(filing.filingIndexUrl);
      const items = Array.isArray(json && json.directory && json.directory.item) ? json.directory.item : [];
      const base = filing.filingIndexUrl.replace(/\/index\.json$/i, '');
      filing.documents = items
        .filter((item) => item && item.name && item.type !== 'dir')
        .slice(0, 8)
        .map((item) => ({
          name: item.name,
          type: item.type || '',
          size: item.size || null,
          url: `${base}/${item.name}`,
        }));
    } catch (_) {
      filing.documents = [];
    }
    return filing;
  }));
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }

  const action = body && body.action;
  if (action === 'export') {
    const ticker = String((body && body.ticker) || '').trim().toUpperCase();
    const rows = Array.isArray(body && body.rows) ? body.rows : [];
    return res.status(200).json({
      success: true,
      filename: `${(ticker || 'filings').toLowerCase()}-filing-evidence.csv`,
      content: _buildCsv(ticker, rows),
    });
  }

  const ticker = body && body.ticker;
  if (!ticker) return res.status(400).json({ success: false, error: 'No ticker provided' });

  try {
    const resolved = await _resolveTicker(ticker);
    if (!resolved) {
      return res.status(404).json({ success: false, error: `No SEC filing found for ${ticker}` });
    }

    const submissions = await _secFetchJson(`https://data.sec.gov/submissions/CIK${resolved.cik}.json`);
    const annualFilings = await _attachDocuments(_buildAnnualFilings(submissions, resolved.cik));

    return res.status(200).json({
      success: true,
      ticker: resolved.ticker || String(ticker).toUpperCase(),
      cik: resolved.cik,
      companyName: resolved.companyName,
      filings: annualFilings,
      evidence: [],
      financials: {},
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = handler;
module.exports._test = {
  _normalizeTicker,
  _buildAnnualFilings,
  _buildCsv,
};
