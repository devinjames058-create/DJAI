'use strict';

const USER_AGENT = 'DJAI Finance dev@djai.app';
const TICKER_INDEX_URL = 'https://www.sec.gov/files/company_tickers.json';
const EDGAR_SUBS_URL = (cik) => `https://data.sec.gov/submissions/CIK${cik}.json`;
const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A']);
const TICKER_TTL = 24 * 60 * 60 * 1000;
const SUBMISSIONS_TTL = 24 * 60 * 60 * 1000;

const _tickerCache = { time: 0, data: null };
const _submissionsCache = new Map();

function _normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase().replace(/[.\-]/g, '');
}

function _normalizeAccession(accession) {
  return String(accession || '').trim().replace(/-/g, '');
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
    lines.push([
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
    ].map(_escapeCsv).join(','));
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

async function _resolveCIK(ticker) {
  const now = Date.now();
  if (!_tickerCache.data || (now - _tickerCache.time > TICKER_TTL)) {
    const raw = await _secFetchJson(TICKER_INDEX_URL);
    const lookup = {};
    for (const entry of Object.values(raw || {})) {
      lookup[_normalizeTicker(entry.ticker)] = {
        cik: String(entry.cik_str || entry.cik).padStart(10, '0'),
        entity: entry.title || entry.ticker,
        ticker: entry.ticker,
      };
    }
    _tickerCache.data = lookup;
    _tickerCache.time = now;
  }
  return _tickerCache.data[_normalizeTicker(ticker)] || null;
}

async function _getSubmissions(paddedCik) {
  const now = Date.now();
  const cached = _submissionsCache.get(paddedCik);
  if (cached && (now - cached.time < SUBMISSIONS_TTL)) return cached.data;
  const subs = await _secFetchJson(EDGAR_SUBS_URL(paddedCik));
  _submissionsCache.set(paddedCik, { time: now, data: subs });
  return subs;
}

function _annualDescription(form, description) {
  if (description && String(description).trim()) return String(description).trim();
  return form === '10-K/A' || form === '20-F/A' ? 'Annual Report Amendment' : 'Annual Report';
}

function _buildAnnualFilings(submissions, cik) {
  const recent = submissions && submissions.filings && submissions.filings.recent ? submissions.filings.recent : {};
  const forms = recent.form || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const accessions = recent.accessionNumber || [];
  const primaryDocs = recent.primaryDocument || [];
  const descriptions = recent.primaryDocDescription || [];
  const numericCik = String(parseInt(cik, 10));
  const filings = [];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!ANNUAL_FORMS.has(form)) continue;
    const accessionNumber = accessions[i] || '';
    const accessionNoDashes = _normalizeAccession(accessionNumber);
    if (!accessionNumber || !accessionNoDashes) continue;
    const primaryDocument = primaryDocs[i] || '';
    filings.push({
      form,
      filedDate: filingDates[i] || null,
      periodEnd: reportDates[i] || null,
      description: _annualDescription(form, descriptions[i]),
      primaryUrl: primaryDocument
        ? `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDashes}/${primaryDocument}`
        : null,
      indexUrl: `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accessionNoDashes}/${accessionNumber}-index.htm`,
      accessionNumber,
    });
  }

  filings.sort((a, b) => Date.parse(b.filedDate || '') - Date.parse(a.filedDate || ''));
  return filings.slice(0, 10);
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

  if (body && body.action === 'export') {
    const ticker = String((body && body.ticker) || '').trim().toUpperCase();
    const rows = Array.isArray(body && body.rows) ? body.rows : [];
    return res.status(200).json({
      ok: true,
      success: true,
      filename: `${(ticker || 'filings').toLowerCase()}-filing-evidence.csv`,
      content: _buildCsv(ticker, rows),
    });
  }

  const ticker = body && body.ticker;
  if (!ticker) {
    return res.status(400).json({ ok: false, success: false, error: 'No ticker provided' });
  }

  try {
    const entry = await _resolveCIK(ticker);
    if (!entry) {
      return res.status(404).json({ ok: false, success: false, error: `No SEC filing found for ${ticker}` });
    }
    const submissions = await _getSubmissions(entry.cik);
    const filings = _buildAnnualFilings(submissions, entry.cik);
    return res.status(200).json({
      ok: true,
      success: true,
      ticker: entry.ticker || String(ticker).toUpperCase(),
      entity: entry.entity,
      cik: String(parseInt(entry.cik, 10)),
      filings,
      evidence: [],
    });
  } catch (e) {
    return res.status(500).json({ ok: false, success: false, error: e.message });
  }
}

module.exports = handler;
module.exports._test = {
  _normalizeTicker,
  _normalizeAccession,
  _buildAnnualFilings,
  _buildCsv,
};
