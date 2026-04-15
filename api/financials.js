'use strict';
// Financials API — SEC EDGAR annual extraction with filing-aware selection and FMP fallback.
// Primary: SEC EDGAR companyfacts + submissions
// Fallback: FMP income/balance/cashflow endpoints (requires FMP_API_KEY)

const TICKER_INDEX_URL = 'https://www.sec.gov/files/company_tickers.json';
const EDGAR_FACTS_URL = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const EDGAR_SUBS_URL = (cik) => `https://data.sec.gov/submissions/CIK${cik}.json`;
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const UA = 'DJAI Finance dev@djai.app';
const TIMEOUT = 15000;
const DAY_MS = 86400000;

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

function _formPriority(form) {
  return (form === '10-K' || form === '20-F' || form === '40-F') ? 1 : 0;
}

const _tickerIndex = { data: null, time: 0 };
const _submissionsCache = new Map();
const _factsCache = new Map();
const _finCache = new Map();

const TICKER_TTL = 24 * 60 * 60 * 1000;
const SUBS_TTL = 24 * 60 * 60 * 1000;
const FACTS_TTL = 7 * 24 * 60 * 60 * 1000;
const FIN_TTL = 24 * 60 * 60 * 1000;

const FIELD_DEFS = {
  incomeStatement: {
    revenue: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
        financial: ['Revenues', 'InterestAndDividendIncomeOperating', 'InterestIncomeExpenseNet', 'NoninterestIncome', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
        energy: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'ElectricUtilityRevenue', 'OilAndGasRevenue', 'RegulatedAndUnregulatedOperatingRevenue'],
        healthcare: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
        reit: ['Revenues', 'RealEstateRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RealEstateRevenue'],
      },
    },
    costOfRevenue: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
        financial: ['InterestExpense', 'InterestExpenseDeposits'],
        energy: ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold', 'FuelCosts', 'CostOfNaturalGasPurchased'],
        healthcare: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
        reit: ['CostOfRevenue', 'RealEstateTaxExpense', 'CostOfGoodsAndServicesSold'],
      },
    },
    grossProfit: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['GrossProfit'],
        financial: [],
        energy: ['GrossProfit'],
        healthcare: ['GrossProfit'],
        reit: [],
      },
    },
    researchAndDevelopmentExpenses: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['ResearchAndDevelopmentExpense'],
        financial: [],
        energy: ['ResearchAndDevelopmentExpense'],
        healthcare: ['ResearchAndDevelopmentExpense'],
        reit: [],
      },
    },
    sellingGeneralAndAdministrativeExpenses: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
        financial: ['NoninterestExpense', 'SellingGeneralAndAdministrativeExpense'],
        energy: ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
        healthcare: ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
        reit: ['GeneralAndAdministrativeExpense', 'SellingGeneralAndAdministrativeExpense'],
      },
    },
    operatingIncome: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['OperatingIncomeLoss'],
        financial: ['OperatingIncomeLoss', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
        energy: ['OperatingIncomeLoss'],
        healthcare: ['OperatingIncomeLoss'],
        reit: ['OperatingIncomeLoss'],
      },
    },
    interestExpense: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['InterestExpense', 'InterestExpenseDebt'],
        financial: ['InterestExpense', 'InterestExpenseDeposits', 'InterestExpenseBorrowings'],
        energy: ['InterestExpense', 'InterestExpenseDebt', 'InterestCostsIncurred'],
        healthcare: ['InterestExpense', 'InterestExpenseDebt'],
        reit: ['InterestExpense', 'InterestExpenseDebt'],
      },
    },
    netIncome: {
      mode: 'duration',
      sourceType: 'canonical',
      tagsBySector: {
        general: ['NetIncomeLoss', 'ProfitLoss'],
        financial: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
        energy: ['NetIncomeLoss', 'ProfitLoss'],
        healthcare: ['NetIncomeLoss', 'ProfitLoss'],
        reit: ['NetIncomeLoss', 'ProfitLoss'],
      },
    },
    epsDiluted: {
      mode: 'duration',
      sourceType: 'per_share',
      unit: 'eps',
      tagsBySector: {
        general: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'DilutedEarningsPerShare', 'NetIncomeLossAvailableToCommonStockholdersBasicAndDilutedPerShare', 'EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare', 'EarningsPerShareBasicAndDiluted'],
        financial: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'DilutedEarningsPerShare', 'NetIncomeLossAvailableToCommonStockholdersBasicAndDilutedPerShare', 'EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare', 'EarningsPerShareBasicAndDiluted'],
        energy: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'DilutedEarningsPerShare', 'NetIncomeLossAvailableToCommonStockholdersBasicAndDilutedPerShare', 'EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare', 'EarningsPerShareBasicAndDiluted'],
        healthcare: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'DilutedEarningsPerShare', 'NetIncomeLossAvailableToCommonStockholdersBasicAndDilutedPerShare', 'EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare', 'EarningsPerShareBasicAndDiluted'],
        reit: ['EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare', 'DilutedEarningsPerShare', 'NetIncomeLossAvailableToCommonStockholdersBasicAndDilutedPerShare', 'EarningsPerShareBasic', 'IncomeLossFromContinuingOperationsPerBasicShare', 'EarningsPerShareBasicAndDiluted'],
      },
    },
    weightedAverageShsOutDil: {
      mode: 'duration',
      sourceType: 'share_count',
      unit: 'shares',
      tagsBySector: {
        general: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfDilutedShares', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfSharesIssuedBasic'],
        financial: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfDilutedShares', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfSharesIssuedBasic'],
        energy: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfDilutedShares', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfSharesIssuedBasic'],
        healthcare: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfDilutedShares', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfSharesIssuedBasic'],
        reit: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted', 'WeightedAverageNumberOfDilutedShares', 'WeightedAverageNumberOfSharesOutstandingBasic', 'WeightedAverageNumberOfSharesIssuedBasic'],
      },
    },
  },
  balanceSheet: {
    cashAndCashEquivalents: {
      mode: 'instant',
      sourceType: 'canonical',
      tags: [
        'CashAndCashEquivalentsAtCarryingValue',
        'CashCashEquivalentsAndShortTermInvestments',
        'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
        'RestrictedCashAndCashEquivalents',
        'CashAndDueFromBanks',
        'InterestBearingDepositsInBanks',
        'FederalFundsSoldAndSecuritiesPurchasedUnderAgreementsToResell',
        'CashDueFromBanksAndInterestBearingDepositsInBanks',
        'Cash',
      ],
    },
    totalCurrentAssets: { mode: 'instant', sourceType: 'canonical', tags: ['AssetsCurrent'] },
    totalAssets: { mode: 'instant', sourceType: 'canonical', tags: ['Assets'] },
    totalCurrentLiabilities: { mode: 'instant', sourceType: 'canonical', tags: ['LiabilitiesCurrent'] },
    longTermDebt: {
      mode: 'instant',
      sourceType: 'canonical',
      tags: [
        'LongTermDebtNoncurrent',
        'LongTermDebt',
        'DebtAndCapitalLeaseObligations',
        'LongTermBorrowings',
        'LongTermFHLBAdvances',
        'UnsecuredLongTermDebt',
        'NotesAndLoansPayableNoncurrent',
        'OtherBorrowingsNoncurrent',
        'LongTermDebtAndCapitalLeaseObligations',
        'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities',
        'OtherBorrowings',
        'NotesPayable',
      ],
    },
    totalLiabilities: {
      mode: 'instant',
      sourceType: 'canonical',
      tags: ['Liabilities', 'TotalLiabilities', 'LiabilitiesFairValueDisclosure', 'LiabilitiesAndStockholdersEquityLessAssets'],
    },
    totalStockholdersEquity: {
      mode: 'instant',
      sourceType: 'canonical',
      tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    },
    bookValuePerShareDirect: {
      mode: 'instant',
      sourceType: 'per_share',
      unit: 'eps',
      tags: ['BookValuePerShare', 'CommonStockEquityPerShare'],
    },
  },
  cashFlow: {
    operatingCashFlow: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities'],
    },
    capitalExpenditure: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: [
        'PaymentsToAcquirePropertyPlantAndEquipment',
        'CapitalExpendituresIncurredButNotYetPaid',
        'PropertyPlantAndEquipmentAdditions',
        'PaymentsToAcquireProductiveAssets',
        'PurchaseOfPropertyAndEquipmentAndIntangibleAssets',
        'AdditionsToPropertyPlantAndEquipment',
        'PaymentsToAcquireOtherPropertyPlantAndEquipment',
        'PaymentsToAcquireCommercialRealEstate',
        'PaymentsToAcquireAndDevelopRealEstate',
        'RealEstateOtherAdditions',
        'DirectCostsOfLeasedAndRentedPropertyOrEquipment',
      ],
    },
    dividendsPaid: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
    },
    commonStockRepurchased: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['PaymentsForRepurchaseOfCommonStock'],
    },
    acquisitionsNet: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross', 'PaymentsToAcquireBusiness'],
    },
    netCashProvidedByUsedInInvestingActivities: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['NetCashProvidedByUsedInInvestingActivities'],
    },
    netCashUsedProvidedByFinancingActivities: {
      mode: 'duration',
      sourceType: 'canonical',
      tags: ['NetCashProvidedByUsedInFinancingActivities', 'NetCashUsedProvidedByFinancingActivities'],
    },
  },
};

const SHARES_OUTSTANDING_FALLBACK_TAGS = ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'];

const _TAXONOMIES = ['us-gaap', 'ifrs-full', 'dei'];

async function _edgarFetch(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    const err = new Error('SEC EDGAR HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function _fmpFetch(path, key, signal) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(FMP_BASE + path + sep + 'apikey=' + key, { signal });
  if (!res.ok) throw new Error('FMP HTTP ' + res.status);
  return res.json();
}

function _normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase().replace(/[.\-]/g, '');
}

function _normalizeAccession(accn) {
  return String(accn || '').replace(/-/g, '').trim();
}

function _safeDateValue(value) {
  const ts = Date.parse(value || '');
  return Number.isFinite(ts) ? ts : null;
}

function _diffDays(a, b) {
  const ta = _safeDateValue(a);
  const tb = _safeDateValue(b);
  if (ta == null || tb == null) return null;
  return Math.abs(ta - tb) / DAY_MS;
}

function _durationDays(entry) {
  const start = _safeDateValue(entry.start);
  const end = _safeDateValue(entry.end);
  if (start == null || end == null || end < start) return null;
  return (end - start) / DAY_MS;
}

function _noNumber(value) {
  return value == null || !Number.isFinite(Number(value));
}

function _sanitizeNumber(value) {
  if (_noNumber(value)) return null;
  return Number(value);
}

function _pushWarning(warnings, message) {
  if (!message) return;
  if (!warnings.includes(message)) warnings.push(message);
}

async function _resolveCIK(ticker) {
  const now = Date.now();
  if (!_tickerIndex.data || (now - _tickerIndex.time > TICKER_TTL)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const raw = await _edgarFetch(TICKER_INDEX_URL, ctrl.signal);
      clearTimeout(timer);
      const lookup = {};
      for (const entry of Object.values(raw)) {
        lookup[_normalizeTicker(entry.ticker)] = {
          cik: String(entry.cik_str || entry.cik).padStart(10, '0'),
          name: entry.title || entry.ticker,
        };
      }
      _tickerIndex.data = lookup;
      _tickerIndex.time = now;
    } catch (e) {
      clearTimeout(timer);
      if (!_tickerIndex.data) throw e;
    }
  }
  return _tickerIndex.data[_normalizeTicker(ticker)] || null;
}

async function _getSubmissions(paddedCik) {
  const now = Date.now();
  const cached = _submissionsCache.get(paddedCik);
  if (cached && (now - cached.time < SUBS_TTL)) return cached.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const subs = await _edgarFetch(EDGAR_SUBS_URL(paddedCik), ctrl.signal);
    clearTimeout(timer);
    _submissionsCache.set(paddedCik, { data: subs, time: now });
    return subs;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function _detectSectorFromSubmissions(subs) {
  const sic = subs && subs.sic != null ? Number(subs.sic) : null;
  if (!Number.isFinite(sic)) return 'general';
  if (sic >= 6500 && sic <= 6599) return 'reit';
  if (sic >= 6000 && sic <= 6999) return 'financial';
  if ((sic >= 1000 && sic <= 1499) || (sic >= 2900 && sic <= 2999) || (sic >= 4900 && sic <= 4999)) return 'energy';
  if ((sic >= 2830 && sic <= 2836) || (sic >= 3841 && sic <= 3851) || sic === 5912 || (sic >= 8000 && sic <= 8099)) return 'healthcare';
  return 'general';
}

function _buildAnnualFilings(subs) {
  const recent = subs && subs.filings && subs.filings.recent ? subs.filings.recent : {};
  const forms = recent.form || [];
  const accessions = recent.accessionNumber || [];
  const filingDates = recent.filingDate || [];
  const reportDates = recent.reportDate || [];
  const byFY = new Map();
  const byAccession = new Map();

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!ANNUAL_FORMS.has(form)) continue;
    const reportDate = reportDates[i] || null;
    const filedDate = filingDates[i] || null;
    const fy = parseInt(String(reportDate || filedDate || '').slice(0, 4), 10);
    if (!fy || Number.isNaN(fy)) continue;
    const filing = {
      form,
      accession: _normalizeAccession(accessions[i]),
      filedDate,
      reportDate,
      fiscalYear: fy,
      formPriority: _formPriority(form),
    };
    const cur = byFY.get(fy);
    if (!cur
        || (_safeDateValue(filing.filedDate) || 0) > (_safeDateValue(cur.filedDate) || 0)
        || (((_safeDateValue(filing.filedDate) || 0) === (_safeDateValue(cur.filedDate) || 0)) && filing.formPriority > cur.formPriority)) {
      byFY.set(fy, filing);
    }
    if (filing.accession) byAccession.set(filing.accession, filing);
  }

  return { byFY, byAccession };
}

function _getTags(def, sector) {
  if (!def) return [];
  if (def.tags) return def.tags;
  const tagsBySector = def.tagsBySector || {};
  return tagsBySector[sector] || tagsBySector.general || [];
}

function _normalizeUnit(unit) {
  return String(unit || '').toLowerCase().replace(/\s+/g, '');
}

function _unitMatches(unit, def, isSharesOpt) {
  const normalized = _normalizeUnit(unit);
  if (def && def.unit === 'eps') return normalized === 'usd/shares' || normalized === 'usd/share';
  if (def && def.unit === 'shares') return normalized === 'shares';
  if (isSharesOpt) return normalized === 'shares';
  return normalized === 'usd';
}

function _isAnnualFact(entry, mode) {
  if (!ANNUAL_FORMS.has(entry.form)) return false;
  if (mode === 'instant') {
    return entry.fp == null || entry.fp === 'FY';
  }
  if (entry.fp === 'FY') return true;
  if (entry.fp != null) return false;
  const days = _durationDays(entry);
  return days != null && days >= 300 && days <= 400;
}

function _deriveFiscalYear(entry) {
  const fromEnd = parseInt(String(entry.end || '').slice(0, 4), 10);
  if (Number.isFinite(fromEnd)) return fromEnd;
  if (entry.fy != null && Number.isFinite(Number(entry.fy))) return Number(entry.fy);
  return null;
}

function _confidenceFor(candidate) {
  if (candidate.exactAccession) return 'high';
  if (candidate.usedShareFallback) return 'medium';
  if (candidate.mode === 'duration' && candidate.entry.fp == null) return 'medium';
  return 'high';
}

function _scoreCandidate(candidate, filing, tagIndex, taxonomyIndex) {
  let score = 0;
  if (candidate.exactAccession) score += 1000000;
  if (candidate.sameFiscalYear) score += 200000;
  if (filing && candidate.entry.form === filing.form) score += 20000;

  const endDiff = filing ? _diffDays(candidate.entry.end, filing.reportDate) : null;
  if (endDiff != null) score += Math.max(0, 10000 - Math.round(endDiff));

  const filedDiff = filing ? _diffDays(candidate.entry.filed, filing.filedDate) : null;
  if (filedDiff != null) score += Math.max(0, 5000 - Math.round(filedDiff));

  score += _formPriority(candidate.entry.form) * 1000;
  score += Math.max(0, 500 - (tagIndex * 10));
  score += Math.max(0, 50 - taxonomyIndex);
  score += (_safeDateValue(candidate.entry.filed) || 0) / 1e12;
  return score;
}

function _makeMetadata(candidate, def, warning) {
  const warnings = [];
  if (warning) warnings.push(warning);
  if (candidate.mode === 'duration' && candidate.entry.fp == null) {
    warnings.push('Annual duration accepted from null fp based on period length');
  }
  if (candidate.usedShareFallback) {
    warnings.push('Used common shares outstanding as diluted-share fallback');
  }
  return {
    tagUsed: candidate.tag,
    sourceType: def.sourceType || 'canonical',
    form: candidate.entry.form || null,
    accession: _normalizeAccession(candidate.entry.accn || candidate.entry.accNum || candidate.filingAccession),
    filedDate: candidate.entry.filed || null,
    fiscalYear: candidate.fy,
    confidence: _confidenceFor(candidate),
    warnings,
  };
}

function _cloneMeta(meta, overrides) {
  return Object.assign({}, meta || {}, overrides || {}, {
    warnings: (meta && Array.isArray(meta.warnings) ? meta.warnings.slice() : []),
  });
}

function _selectFieldMap(facts, filings, def, sector, opts) {
  const tags = _getTags(def, sector);
  const mode = def.mode;
  const useSharesUnit = opts && opts.isShares;
  const yearMap = {};
  const metaMap = {};

  for (let tagIndex = 0; tagIndex < tags.length; tagIndex++) {
    const tag = tags[tagIndex];
    for (let taxonomyIndex = 0; taxonomyIndex < _TAXONOMIES.length; taxonomyIndex++) {
      const taxonomy = _TAXONOMIES[taxonomyIndex];
      const tagData = facts && facts.facts && facts.facts[taxonomy] && facts.facts[taxonomy][tag];
      if (!tagData || !tagData.units) continue;

      for (const unit of Object.keys(tagData.units)) {
        if (!_unitMatches(unit, def, useSharesUnit)) continue;
        const entries = tagData.units[unit];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (!_isAnnualFact(entry, mode)) continue;
          const fy = _deriveFiscalYear(entry);
          if (!fy) continue;
          const filing = filings.byFY.get(fy) || null;
          const entryAccession = _normalizeAccession(entry.accn || entry.accNum);
          const exactAccession = !!(filing && entryAccession && filing.accession && entryAccession === filing.accession);
          const candidate = {
            entry,
            tag,
            fy,
            mode,
            exactAccession,
            sameFiscalYear: !!filing,
            filingAccession: filing ? filing.accession : null,
            usedShareFallback: tag === 'CommonStockSharesOutstanding' || tag === 'EntityCommonStockSharesOutstanding',
          };
          const score = _scoreCandidate(candidate, filing, tagIndex, taxonomyIndex);
          const value = _sanitizeNumber(entry.val);
          if (value == null) continue;

          if (!yearMap[fy] || score > yearMap[fy].score) {
            yearMap[fy] = {
              value,
              end: entry.end || null,
              score,
              candidate,
            };
            metaMap[fy] = _makeMetadata(candidate, def);
          }
        }
      }
    }
  }

  return { values: yearMap, meta: metaMap };
}

function _getFieldValue(fieldMap, fy) {
  return fieldMap.values[fy] ? fieldMap.values[fy].value : null;
}

function _getFieldEnd(fieldMap, fy) {
  return fieldMap.values[fy] ? fieldMap.values[fy].end : null;
}

function _pickDate(fieldMaps, fy, filings) {
  const filing = filings && filings.byFY ? filings.byFY.get(fy) : null;
  if (filing && filing.reportDate) return filing.reportDate;
  for (let i = 0; i < fieldMaps.length; i++) {
    const end = _getFieldEnd(fieldMaps[i], fy);
    if (end) return end;
  }
  return String(fy) + '-12-31';
}

function _selectYearsFromFieldMaps(fieldMaps) {
  const fySet = new Set();
  for (let i = 0; i < fieldMaps.length; i++) {
    const values = fieldMaps[i].values;
    for (const key of Object.keys(values)) fySet.add(Number(key));
  }
  return Array.from(fySet).sort((a, b) => b - a).slice(0, 5);
}

function _setVerificationField(verification, section, fy, field, meta) {
  if (!meta) return;
  if (!verification.fields[section][fy]) verification.fields[section][fy] = {};
  verification.fields[section][fy][field] = meta;
}

function _buildIncomeStatement(facts, sector, filings, verification) {
  const defs = FIELD_DEFS.incomeStatement;
  const maps = {};
  for (const field of Object.keys(defs)) {
    maps[field] = _selectFieldMap(facts, filings, defs[field], sector, {
      isShares: defs[field].unit === 'shares',
    });
  }
  const sharesFallbackMap = _selectFieldMap(
    facts,
    filings,
    { mode: 'instant', tags: SHARES_OUTSTANDING_FALLBACK_TAGS, unit: 'shares', sourceType: 'share_count' },
    sector,
    { isShares: true }
  );

  const years = _selectYearsFromFieldMaps([maps.revenue, maps.netIncome, maps.operatingIncome, maps.epsDiluted, maps.weightedAverageShsOutDil]);
  const rows = years.map((fy) => {
    const rev = _getFieldValue(maps.revenue, fy);
    const cor = _getFieldValue(maps.costOfRevenue, fy);
    let gp = _getFieldValue(maps.grossProfit, fy);
    let dilutedShares = _getFieldValue(maps.weightedAverageShsOutDil, fy);
    const grossProfitTags = _getTags(defs.grossProfit, sector);
    if (gp == null && rev != null && cor != null && grossProfitTags.length > 0) {
      gp = rev - cor;
      const baseMeta = maps.costOfRevenue.meta[fy] || maps.revenue.meta[fy];
      maps.grossProfit.meta[fy] = _cloneMeta(baseMeta, {
        tagUsed: 'derived:grossProfit',
        sourceType: 'derived',
        confidence: 'medium',
      });
      maps.grossProfit.meta[fy].warnings.push('Derived gross profit from revenue - costOfRevenue');
    }
    if (dilutedShares == null) {
      dilutedShares = _getFieldValue(sharesFallbackMap, fy);
      if (dilutedShares != null) {
        maps.weightedAverageShsOutDil.values[fy] = sharesFallbackMap.values[fy];
        const baseMeta = sharesFallbackMap.meta[fy];
        maps.weightedAverageShsOutDil.meta[fy] = _cloneMeta(baseMeta, {
          tagUsed: 'fallback:' + (baseMeta ? baseMeta.tagUsed : 'sharesOutstanding'),
          sourceType: 'share_count',
          confidence: 'medium',
        });
        maps.weightedAverageShsOutDil.meta[fy].warnings.push('Used common shares outstanding fallback for weightedAverageShsOutDil');
      }
    }
    const row = {
      year: String(fy),
      date: _pickDate([maps.revenue, maps.netIncome, maps.operatingIncome], fy, filings),
      calendarYear: String(fy),
      revenue: rev,
      costOfRevenue: _getFieldValue(maps.costOfRevenue, fy),
      grossProfit: _sanitizeNumber(gp),
      researchAndDevelopmentExpenses: _getFieldValue(maps.researchAndDevelopmentExpenses, fy),
      sellingGeneralAndAdministrativeExpenses: _getFieldValue(maps.sellingGeneralAndAdministrativeExpenses, fy),
      operatingIncome: _getFieldValue(maps.operatingIncome, fy),
      interestExpense: _getFieldValue(maps.interestExpense, fy),
      netIncome: _getFieldValue(maps.netIncome, fy),
      epsDiluted: _getFieldValue(maps.epsDiluted, fy),
      weightedAverageShsOutDil: dilutedShares,
    };

    for (const field of Object.keys(row)) {
      if (field === 'year' || field === 'date' || field === 'calendarYear') continue;
      row[field] = _sanitizeNumber(row[field]);
    }

    _setVerificationField(verification, 'incomeStatement', fy, 'revenue', maps.revenue.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'costOfRevenue', maps.costOfRevenue.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'grossProfit', maps.grossProfit.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'researchAndDevelopmentExpenses', maps.researchAndDevelopmentExpenses.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'sellingGeneralAndAdministrativeExpenses', maps.sellingGeneralAndAdministrativeExpenses.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'operatingIncome', maps.operatingIncome.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'interestExpense', maps.interestExpense.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'netIncome', maps.netIncome.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'epsDiluted', maps.epsDiluted.meta[fy]);
    _setVerificationField(verification, 'incomeStatement', fy, 'weightedAverageShsOutDil', maps.weightedAverageShsOutDil.meta[fy]);
    return row;
  });

  return { rows, maps };
}

function _buildBalanceSheet(facts, filings, incomeMaps, verification) {
  const defs = FIELD_DEFS.balanceSheet;
  const maps = {};
  for (const field of Object.keys(defs)) {
    maps[field] = _selectFieldMap(facts, filings, defs[field], 'general', {
      isShares: defs[field].unit === 'shares',
    });
  }

  const years = _selectYearsFromFieldMaps([
    maps.totalAssets,
    maps.totalLiabilities,
    maps.totalStockholdersEquity,
    maps.cashAndCashEquivalents,
    maps.longTermDebt,
    incomeMaps.weightedAverageShsOutDil,
  ]);

  const rows = years.map((fy) => {
    const assets = _getFieldValue(maps.totalAssets, fy);
    let liabilities = _getFieldValue(maps.totalLiabilities, fy);
    let equity = _getFieldValue(maps.totalStockholdersEquity, fy);
    if (equity == null && assets != null && liabilities != null) {
      equity = assets - liabilities;
      const baseMeta = maps.totalAssets.meta[fy] || maps.totalLiabilities.meta[fy];
      maps.totalStockholdersEquity.meta[fy] = _cloneMeta(baseMeta, {
        tagUsed: 'derived:totalStockholdersEquity',
        sourceType: 'derived',
        confidence: 'medium',
      });
      maps.totalStockholdersEquity.meta[fy].warnings.push('Derived totalStockholdersEquity from assets - liabilities');
    }
    if (liabilities == null && assets != null && equity != null) {
      liabilities = assets - equity;
      const baseMeta = maps.totalAssets.meta[fy] || maps.totalStockholdersEquity.meta[fy];
      maps.totalLiabilities.meta[fy] = _cloneMeta(baseMeta, {
        tagUsed: 'derived:totalLiabilities',
        sourceType: 'derived',
        confidence: 'medium',
      });
      maps.totalLiabilities.meta[fy].warnings.push('Derived totalLiabilities from assets - totalStockholdersEquity');
    }

    let bvps = _getFieldValue(maps.bookValuePerShareDirect, fy);
    if (bvps == null && equity != null && _getFieldValue(incomeMaps.weightedAverageShsOutDil, fy) != null) {
      const shares = _getFieldValue(incomeMaps.weightedAverageShsOutDil, fy);
      if (shares !== 0) {
        bvps = equity / shares;
        const baseMeta = incomeMaps.weightedAverageShsOutDil.meta[fy] || maps.totalStockholdersEquity.meta[fy];
        maps.bookValuePerShareDirect.meta[fy] = _cloneMeta(baseMeta, {
          tagUsed: 'derived:bookValuePerShare',
          sourceType: 'derived',
          confidence: (baseMeta && baseMeta.confidence === 'medium') ? 'medium' : 'high',
        });
        maps.bookValuePerShareDirect.meta[fy].warnings.push('Derived bookValuePerShare from totalStockholdersEquity / weightedAverageShsOutDil');
      }
    }

    const row = {
      year: String(fy),
      date: _pickDate([maps.totalAssets, maps.totalStockholdersEquity, maps.totalLiabilities], fy, filings),
      calendarYear: String(fy),
      cashAndCashEquivalents: _getFieldValue(maps.cashAndCashEquivalents, fy),
      totalCurrentAssets: _getFieldValue(maps.totalCurrentAssets, fy),
      totalAssets: assets,
      totalCurrentLiabilities: _getFieldValue(maps.totalCurrentLiabilities, fy),
      longTermDebt: _getFieldValue(maps.longTermDebt, fy),
      totalLiabilities: liabilities,
      totalStockholdersEquity: equity,
      bookValuePerShare: bvps,
    };

    for (const field of Object.keys(row)) {
      if (field === 'year' || field === 'date' || field === 'calendarYear') continue;
      row[field] = _sanitizeNumber(row[field]);
    }

    _setVerificationField(verification, 'balanceSheet', fy, 'cashAndCashEquivalents', maps.cashAndCashEquivalents.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'totalCurrentAssets', maps.totalCurrentAssets.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'totalAssets', maps.totalAssets.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'totalCurrentLiabilities', maps.totalCurrentLiabilities.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'longTermDebt', maps.longTermDebt.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'totalLiabilities', maps.totalLiabilities.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'totalStockholdersEquity', maps.totalStockholdersEquity.meta[fy]);
    _setVerificationField(verification, 'balanceSheet', fy, 'bookValuePerShare', maps.bookValuePerShareDirect.meta[fy]);
    return row;
  });

  return { rows, maps };
}

function _buildCashFlow(facts, filings, verification) {
  const defs = FIELD_DEFS.cashFlow;
  const maps = {};
  for (const field of Object.keys(defs)) {
    maps[field] = _selectFieldMap(facts, filings, defs[field], 'general', {});
  }

  const years = _selectYearsFromFieldMaps([
    maps.operatingCashFlow,
    maps.capitalExpenditure,
    maps.netCashProvidedByUsedInInvestingActivities,
    maps.netCashUsedProvidedByFinancingActivities,
  ]);

  const rows = years.map((fy) => {
    const opCF = _getFieldValue(maps.operatingCashFlow, fy);
    const capexRaw = _getFieldValue(maps.capitalExpenditure, fy);
    const capex = capexRaw != null ? -Math.abs(capexRaw) : null;
    const fcf = (opCF != null && capex != null) ? opCF - Math.abs(capex) : null;
    const row = {
      year: String(fy),
      date: _pickDate([maps.operatingCashFlow, maps.capitalExpenditure, maps.netCashProvidedByUsedInInvestingActivities], fy, filings),
      calendarYear: String(fy),
      operatingCashFlow: opCF,
      capitalExpenditure: capex,
      freeCashFlow: fcf,
      acquisitionsNet: _getFieldValue(maps.acquisitionsNet, fy) != null ? -Math.abs(_getFieldValue(maps.acquisitionsNet, fy)) : null,
      dividendsPaid: _getFieldValue(maps.dividendsPaid, fy) != null ? -Math.abs(_getFieldValue(maps.dividendsPaid, fy)) : null,
      commonStockRepurchased: _getFieldValue(maps.commonStockRepurchased, fy) != null ? -Math.abs(_getFieldValue(maps.commonStockRepurchased, fy)) : null,
      netCashProvidedByUsedInInvestingActivities: _getFieldValue(maps.netCashProvidedByUsedInInvestingActivities, fy),
      netCashUsedProvidedByFinancingActivities: _getFieldValue(maps.netCashUsedProvidedByFinancingActivities, fy),
    };

    for (const field of Object.keys(row)) {
      if (field === 'year' || field === 'date' || field === 'calendarYear') continue;
      row[field] = _sanitizeNumber(row[field]);
    }

    const capexMeta = maps.capitalExpenditure.meta[fy];
    if (row.freeCashFlow != null) {
      const baseMeta = capexMeta || maps.operatingCashFlow.meta[fy];
      maps.freeCashFlowMeta = maps.freeCashFlowMeta || {};
      maps.freeCashFlowMeta[fy] = _cloneMeta(baseMeta, {
        tagUsed: 'derived:freeCashFlow',
        sourceType: 'derived',
        confidence: 'high',
      });
      maps.freeCashFlowMeta[fy].warnings.push('Derived freeCashFlow from operatingCashFlow - abs(capitalExpenditure)');
    }

    _setVerificationField(verification, 'cashFlow', fy, 'operatingCashFlow', maps.operatingCashFlow.meta[fy]);
    _setVerificationField(verification, 'cashFlow', fy, 'capitalExpenditure', capexMeta);
    _setVerificationField(verification, 'cashFlow', fy, 'freeCashFlow', maps.freeCashFlowMeta ? maps.freeCashFlowMeta[fy] : null);
    _setVerificationField(verification, 'cashFlow', fy, 'acquisitionsNet', maps.acquisitionsNet.meta[fy]);
    _setVerificationField(verification, 'cashFlow', fy, 'dividendsPaid', maps.dividendsPaid.meta[fy]);
    _setVerificationField(verification, 'cashFlow', fy, 'commonStockRepurchased', maps.commonStockRepurchased.meta[fy]);
    _setVerificationField(verification, 'cashFlow', fy, 'netCashProvidedByUsedInInvestingActivities', maps.netCashProvidedByUsedInInvestingActivities.meta[fy]);
    _setVerificationField(verification, 'cashFlow', fy, 'netCashUsedProvidedByFinancingActivities', maps.netCashUsedProvidedByFinancingActivities.meta[fy]);
    return row;
  });

  return { rows, maps };
}

function _statementHasData(rows, fields) {
  return rows.some((row) => fields.some((field) => row[field] != null));
}

function _edgarQualityOk(incomeStatement, balanceSheet, cashFlow) {
  const isOk = _statementHasData(incomeStatement, ['revenue', 'netIncome', 'operatingIncome', 'epsDiluted', 'weightedAverageShsOutDil']);
  const bsOk = _statementHasData(balanceSheet, ['cashAndCashEquivalents', 'totalAssets', 'longTermDebt', 'totalLiabilities', 'totalStockholdersEquity', 'bookValuePerShare']);
  const cfOk = _statementHasData(cashFlow, ['operatingCashFlow', 'capitalExpenditure', 'freeCashFlow']);
  return (isOk ? 1 : 0) + (bsOk ? 1 : 0) + (cfOk ? 1 : 0) >= 2;
}

async function _getCompanyFacts(paddedCik) {
  const cached = _factsCache.get(paddedCik);
  if (cached && (Date.now() - cached.time < FACTS_TTL)) return cached.data;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const data = await _edgarFetch(EDGAR_FACTS_URL(paddedCik), ctrl.signal);
    clearTimeout(timer);
    _factsCache.set(paddedCik, { data, time: Date.now() });
    return data;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

function _finalizeVerification(verification) {
  const compact = {
    warnings: verification.warnings.slice(),
    fields: {
      incomeStatement: verification.fields.incomeStatement,
      balanceSheet: verification.fields.balanceSheet,
      cashFlow: verification.fields.cashFlow,
    },
  };
  if (!compact.warnings.length && !Object.keys(compact.fields.incomeStatement).length
      && !Object.keys(compact.fields.balanceSheet).length
      && !Object.keys(compact.fields.cashFlow).length) {
    return undefined;
  }
  return compact;
}

function _stripInvalidNumbers(rows) {
  return rows.map((row) => {
    const clean = Object.assign({}, row);
    for (const key of Object.keys(clean)) {
      if (key === 'year' || key === 'date' || key === 'calendarYear') continue;
      clean[key] = _sanitizeNumber(clean[key]);
    }
    return clean;
  });
}

async function _tryEdgar(ticker) {
  const entry = await _resolveCIK(ticker);
  if (!entry) return null;

  const cik = entry.cik;
  const [subs, facts] = await Promise.all([_getSubmissions(cik), _getCompanyFacts(cik)]);
  const sector = _detectSectorFromSubmissions(subs);
  const filings = _buildAnnualFilings(subs);
  const verification = {
    warnings: [],
    fields: {
      incomeStatement: {},
      balanceSheet: {},
      cashFlow: {},
    },
  };

  const income = _buildIncomeStatement(facts, sector, filings, verification);
  const balance = _buildBalanceSheet(facts, filings, income.maps, verification);
  const cashFlow = _buildCashFlow(facts, filings, verification);

  let years = _selectYearsFromFieldMaps([
    income.maps.revenue,
    income.maps.netIncome,
    income.maps.epsDiluted,
    income.maps.weightedAverageShsOutDil,
    balance.maps.totalAssets,
    balance.maps.totalLiabilities,
    balance.maps.longTermDebt,
    balance.maps.cashAndCashEquivalents,
    cashFlow.maps.operatingCashFlow,
    cashFlow.maps.capitalExpenditure,
  ]);

  if (!years.length) return null;
  years = years.slice(0, 5);

  const yearSet = new Set(years.map(String));
  const incomeRows = _stripInvalidNumbers(income.rows.filter((row) => yearSet.has(row.year))).map((r) => Object.assign(r, { _source: 'EDGAR' }));
  const balanceRows = _stripInvalidNumbers(balance.rows.filter((row) => yearSet.has(row.year))).map((r) => Object.assign(r, { _source: 'EDGAR' }));
  const cashRows = _stripInvalidNumbers(cashFlow.rows.filter((row) => yearSet.has(row.year))).map((r) => Object.assign(r, { _source: 'EDGAR' }));

  const edgarRevenueYears = incomeRows.filter((r) => r.revenue != null).length;
  if (edgarRevenueYears < 2) {
    _pushWarning(verification.warnings, 'EDGAR returned fewer than 2 years of revenue; falling back to FMP');
    return null;
  }

  if (!_edgarQualityOk(incomeRows, balanceRows, cashRows)) {
    _pushWarning(verification.warnings, 'EDGAR annual extraction did not meet minimum statement coverage');
    return null;
  }

  await _supplementWithFmp(ticker, incomeRows, balanceRows, cashRows, verification);
  _annotateUnresolvedFinancialFields(facts, incomeRows, balanceRows, verification);

  if (!_statementHasData(cashRows, ['capitalExpenditure'])) {
    if (sector === 'financial') {
      _pushWarning(verification.warnings, 'Capital expenditure unavailable from annual companyfacts for this financial-sector issuer; freeCashFlow not derived without reliable CapEx');
    } else {
      _pushWarning(verification.warnings, 'Capital expenditure unavailable from annual companyfacts');
    }
  }

  return {
    entity: entry.name,
    ticker,
    cik: cik.replace(/^0+/, ''),
    source: 'SEC EDGAR annual companyfacts',
    incomeStatement: incomeRows,
    balanceSheet: balanceRows,
    cashFlow: cashRows,
    verification: _finalizeVerification(verification),
  };
}

function _normFmpIS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map((r) => ({
    _source: 'FMP',
    year: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    date: r.date != null ? r.date : null,
    calendarYear: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    revenue: _sanitizeNumber(r.revenue),
    costOfRevenue: _sanitizeNumber(r.costOfRevenue),
    grossProfit: _sanitizeNumber(r.grossProfit),
    researchAndDevelopmentExpenses: _sanitizeNumber(r.researchAndDevelopmentExpenses),
    sellingGeneralAndAdministrativeExpenses: _sanitizeNumber(r.sellingGeneralAndAdministrativeExpenses),
    operatingIncome: _sanitizeNumber(r.operatingIncome),
    interestExpense: _sanitizeNumber(r.interestExpense),
    netIncome: _sanitizeNumber(r.netIncome),
    epsDiluted: _sanitizeNumber(r.epsDiluted),
    weightedAverageShsOutDil: _sanitizeNumber(r.weightedAverageShsOutDil),
  }));
}

function _normFmpBS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map((r) => ({
    _source: 'FMP',
    year: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    date: r.date != null ? r.date : null,
    calendarYear: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    cashAndCashEquivalents: _sanitizeNumber(r.cashAndCashEquivalents),
    totalCurrentAssets: _sanitizeNumber(r.totalCurrentAssets),
    totalAssets: _sanitizeNumber(r.totalAssets),
    totalCurrentLiabilities: _sanitizeNumber(r.totalCurrentLiabilities),
    longTermDebt: _sanitizeNumber(r.longTermDebt),
    totalLiabilities: _sanitizeNumber(r.totalLiabilities),
    totalStockholdersEquity: _sanitizeNumber(r.totalStockholdersEquity),
    bookValuePerShare: _sanitizeNumber(r.bookValuePerShare),
  }));
}

function _normFmpCF(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map((r) => ({
    _source: 'FMP',
    year: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    date: r.date != null ? r.date : null,
    calendarYear: r.calendarYear != null ? String(r.calendarYear) : (r.date ? String(r.date).slice(0, 4) : null),
    operatingCashFlow: _sanitizeNumber(r.operatingCashFlow),
    capitalExpenditure: _sanitizeNumber(r.capitalExpenditure),
    freeCashFlow: _sanitizeNumber(r.freeCashFlow),
    acquisitionsNet: _sanitizeNumber(r.acquisitionsNet),
    dividendsPaid: _sanitizeNumber(r.dividendsPaid),
    commonStockRepurchased: _sanitizeNumber(r.commonStockRepurchased),
    netCashProvidedByUsedInInvestingActivities: _sanitizeNumber(r.netCashProvidedByUsedInInvestingActivities),
    netCashUsedProvidedByFinancingActivities: _sanitizeNumber(r.netCashUsedProvidedByFinancingActivities),
  }));
}

async function _fetchFmpPayload(ticker) {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const [isRaw, bsRaw, cfRaw] = await Promise.all([
      _fmpFetch('/income-statement/' + encodeURIComponent(ticker) + '?limit=5', key, ctrl.signal),
      _fmpFetch('/balance-sheet-statement/' + encodeURIComponent(ticker) + '?limit=5', key, ctrl.signal),
      _fmpFetch('/cash-flow-statement/' + encodeURIComponent(ticker) + '?limit=5', key, ctrl.signal),
    ]);
    clearTimeout(timer);

    const incomeStatement = _normFmpIS(isRaw);
    const balanceSheet = _normFmpBS(bsRaw);
    const cashFlow = _normFmpCF(cfRaw);
    if (!incomeStatement.length && !balanceSheet.length && !cashFlow.length) return null;

    return {
      entity: Array.isArray(isRaw) && isRaw[0] && isRaw[0].symbol ? isRaw[0].symbol : ticker,
      ticker,
      incomeStatement,
      balanceSheet,
      cashFlow,
    };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

function _makeSupplementMeta(fy, field, sourceLabel) {
  return {
    tagUsed: sourceLabel + ':' + field,
    sourceType: 'supplemental_fallback',
    form: null,
    accession: null,
    filedDate: null,
    fiscalYear: Number(fy),
    confidence: 'low',
    warnings: ['Supplemented from ' + sourceLabel + ' because SEC EDGAR annual companyfacts was blank'],
  };
}

function _rowYear(row) {
  return String((row && (row.year || row.calendarYear)) || '');
}

function _rowDate(row) {
  return String((row && row.date) || '');
}

function _rowYearFromDate(row) {
  return _rowDate(row).slice(0, 4);
}

function _valueLooksPlausible(field, value) {
  const num = _sanitizeNumber(value);
  if (num == null) return false;
  if (field === 'weightedAverageShsOutDil' || field === 'longTermDebt') return num >= 0;
  return true;
}

function _needsFmpSupplement(incomeRows, balanceRows, cashRows) {
  return incomeRows.some((row) => row.epsDiluted == null || row.weightedAverageShsOutDil == null)
    || balanceRows.some((row) => row.longTermDebt == null || row.bookValuePerShare == null);
}

function _mergeSupplementSection(baseRows, supplementRows, section, fields, verification) {
  const supplementByYear = new Map((Array.isArray(supplementRows) ? supplementRows : []).map((row) => [_rowYear(row), row]));
  let changed = 0;
  for (let i = 0; i < baseRows.length; i++) {
    const row = baseRows[i];
    const fy = _rowYear(row);
    const supplement = supplementByYear.get(fy);
    if (!supplement) continue;
    if (_rowYearFromDate(supplement) && _rowYearFromDate(supplement) !== fy) continue;
    for (let j = 0; j < fields.length; j++) {
      const field = fields[j];
      if (row[field] != null || supplement[field] == null) continue;
      const value = _sanitizeNumber(supplement[field]);
      if (!_valueLooksPlausible(field, value)) continue;
      row[field] = value;
      _setVerificationField(verification, section, Number(fy), field, _makeSupplementMeta(fy, field, 'FMP'));
      changed++;
    }
  }
  return changed;
}

function _deriveSupplementedBookValuePerShare(incomeRows, balanceRows, verification) {
  const incomeByYear = new Map((Array.isArray(incomeRows) ? incomeRows : []).map((row) => [_rowYear(row), row]));
  let changed = 0;
  for (let i = 0; i < balanceRows.length; i++) {
    const row = balanceRows[i];
    if (row.bookValuePerShare != null || row.totalStockholdersEquity == null) continue;
    const incomeRow = incomeByYear.get(_rowYear(row));
    const shares = incomeRow ? _sanitizeNumber(incomeRow.weightedAverageShsOutDil) : null;
    if (shares == null || shares === 0) continue;
    row.bookValuePerShare = row.totalStockholdersEquity / shares;
    _setVerificationField(
      verification,
      'balanceSheet',
      Number(_rowYear(row)),
      'bookValuePerShare',
      {
        tagUsed: 'derived:bookValuePerShare',
        sourceType: 'derived',
        form: null,
        accession: null,
        filedDate: null,
        fiscalYear: Number(_rowYear(row)),
        confidence: 'low',
        warnings: ['Derived from totalStockholdersEquity / weightedAverageShsOutDil after supplemental fallback'],
      }
    );
    changed++;
  }
  return changed;
}

async function _supplementWithFmp(ticker, incomeRows, balanceRows, cashRows, verification) {
  if (!_needsFmpSupplement(incomeRows, balanceRows, cashRows)) return false;
  const fmpPayload = await _fetchFmpPayload(ticker);
  if (!fmpPayload) return false;

  let changed = 0;
  changed += _mergeSupplementSection(incomeRows, fmpPayload.incomeStatement, 'incomeStatement', ['epsDiluted', 'weightedAverageShsOutDil'], verification);
  changed += _mergeSupplementSection(balanceRows, fmpPayload.balanceSheet, 'balanceSheet', ['longTermDebt', 'bookValuePerShare'], verification);
  changed += _deriveSupplementedBookValuePerShare(incomeRows, balanceRows, verification);

  if (changed > 0) {
    _pushWarning(verification.warnings, 'Supplemented missing annual fields from FMP where SEC EDGAR companyfacts was blank');
  }
  return changed > 0;
}

function _hasAnnualFactInUnits(facts, tags, allowedUnits, disallowedUnits) {
  const allowed = new Set((allowedUnits || []).map(_normalizeUnit));
  const disallowed = new Set((disallowedUnits || []).map(_normalizeUnit));
  for (let taxonomyIndex = 0; taxonomyIndex < _TAXONOMIES.length; taxonomyIndex++) {
    const taxonomy = _TAXONOMIES[taxonomyIndex];
    for (let tagIndex = 0; tagIndex < tags.length; tagIndex++) {
      const tag = tags[tagIndex];
      const tagData = facts && facts.facts && facts.facts[taxonomy] && facts.facts[taxonomy][tag];
      if (!tagData || !tagData.units) continue;
      for (const unit of Object.keys(tagData.units)) {
        const normalizedUnit = _normalizeUnit(unit);
        if (allowed.size && !allowed.has(normalizedUnit)) continue;
        if (disallowed.size && !disallowed.has(normalizedUnit)) continue;
        const entries = tagData.units[unit] || [];
        for (let i = 0; i < entries.length; i++) {
          if (_isAnnualFact(entries[i], 'instant')) return true;
        }
      }
    }
  }
  return false;
}

function _setUnresolvedFieldMeta(verification, section, fy, field, warning) {
  if (verification.fields[section][fy] && verification.fields[section][fy][field]) return;
  _setVerificationField(verification, section, fy, field, {
    tagUsed: null,
    sourceType: 'unavailable',
    form: null,
    accession: null,
    filedDate: null,
    fiscalYear: Number(fy),
    confidence: 'low',
    warnings: [warning],
  });
}

function _annotateUnresolvedFinancialFields(facts, incomeRows, balanceRows, verification) {
  if (incomeRows.some((row) => row.epsDiluted == null)) {
    _pushWarning(verification.warnings, 'No usable annual diluted EPS fact found in companyfacts for some rows');
    for (let i = 0; i < incomeRows.length; i++) {
      if (incomeRows[i].epsDiluted == null) {
        _setUnresolvedFieldMeta(verification, 'incomeStatement', Number(_rowYear(incomeRows[i])), 'epsDiluted', 'No usable annual diluted EPS fact found in companyfacts');
      }
    }
  }
  if (incomeRows.some((row) => row.weightedAverageShsOutDil == null)) {
    _pushWarning(verification.warnings, 'No usable annual diluted share-count fact found in companyfacts for some rows');
    for (let i = 0; i < incomeRows.length; i++) {
      if (incomeRows[i].weightedAverageShsOutDil == null) {
        _setUnresolvedFieldMeta(verification, 'incomeStatement', Number(_rowYear(incomeRows[i])), 'weightedAverageShsOutDil', 'No usable annual diluted share-count fact found');
      }
    }
  }
  if (balanceRows.some((row) => row.bookValuePerShare == null)) {
    _pushWarning(verification.warnings, 'Book value per share not derived for some rows because share-count basis was unavailable');
    for (let i = 0; i < balanceRows.length; i++) {
      if (balanceRows[i].bookValuePerShare == null) {
        _setUnresolvedFieldMeta(verification, 'balanceSheet', Number(_rowYear(balanceRows[i])), 'bookValuePerShare', 'Book value per share not derived because share-count basis was unavailable');
      }
    }
  }
  if (balanceRows.some((row) => row.longTermDebt == null)) {
    const debtTags = FIELD_DEFS.balanceSheet.longTermDebt.tags;
    const hasMixedCurrencyDebt = _hasAnnualFactInUnits(facts, debtTags, [], ['eur', 'gbp', 'jpy', 'cad', 'cny']);
    const warning = hasMixedCurrencyDebt
      ? 'Long-term debt unavailable because only mixed-currency or non-comparable annual facts were found'
      : 'No usable annual long-term debt fact found in companyfacts';
    _pushWarning(verification.warnings, warning);
    for (let i = 0; i < balanceRows.length; i++) {
      if (balanceRows[i].longTermDebt == null) {
        _setUnresolvedFieldMeta(verification, 'balanceSheet', Number(_rowYear(balanceRows[i])), 'longTermDebt', warning);
      }
    }
  }
}

async function _tryFmp(ticker) {
  const payload = await _fetchFmpPayload(ticker);
  if (!payload) return null;

  return Object.assign({}, payload, {
    source: 'FMP (SEC filings fallback)',
    verification: {
      warnings: ['Served from FMP fallback because SEC EDGAR annual extraction was unavailable'],
      fields: { incomeStatement: {}, balanceSheet: {}, cashFlow: {} },
    },
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let ticker = ((req.query && req.query.ticker) || '').trim().toUpperCase();
  if (!ticker && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    ticker = ((body && body.ticker) || '').trim().toUpperCase();
  }
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  const cacheKey = 'v7_' + _normalizeTicker(ticker);
  const cached = _finCache.get(cacheKey);
  if (cached && (Date.now() - cached.time < FIN_TTL)) {
    return res.status(200).json(Object.assign({ ok: true, cached: true }, cached.data));
  }

  let payload = null;
  let lastErr = null;
  try {
    payload = await _tryEdgar(ticker);
  } catch (e) {
    lastErr = e;
    console.log('[financials] EDGAR error for ' + ticker + ': ' + e.message);
  }

  if (!payload) {
    try {
      payload = await _tryFmp(ticker);
    } catch (e) {
      if (!lastErr) lastErr = e;
    }
  }

  if (!payload) {
    if (lastErr) {
      const timedOut = lastErr.name === 'AbortError';
      return res.status(timedOut ? 504 : 502).json({
        ok: false,
        error: timedOut ? 'Data providers timed out — try again' : 'Financial data unavailable',
        retryable: true,
      });
    }
    return res.status(404).json({ ok: false, error: 'No financial data found for this ticker' });
  }

  if (payload.incomeStatement.length || payload.balanceSheet.length || payload.cashFlow.length) {
    _finCache.set(cacheKey, { data: payload, time: Date.now() });
  }

  return res.status(200).json(Object.assign({ ok: true, cached: false }, payload));
};

module.exports._test = {
  _annotateUnresolvedFinancialFields,
  _buildAnnualFilings,
  _buildBalanceSheet,
  _buildCashFlow,
  _buildIncomeStatement,
  _detectSectorFromSubmissions,
  _edgarQualityOk,
  _deriveSupplementedBookValuePerShare,
  _hasAnnualFactInUnits,
  _extractDuration: (facts, tags, opts) => _selectFieldMap(facts, { byFY: new Map(), byAccession: new Map() }, { mode: 'duration', tags, unit: opts && opts.isShares ? 'shares' : (opts && opts.isEps ? 'eps' : undefined), sourceType: 'test' }, 'general', opts),
  _extractInstant: (facts, tags, opts) => _selectFieldMap(facts, { byFY: new Map(), byAccession: new Map() }, { mode: 'instant', tags, unit: opts && opts.isShares ? 'shares' : undefined, sourceType: 'test' }, 'general', opts),
  _mergeSupplementSection,
  _needsFmpSupplement,
};
