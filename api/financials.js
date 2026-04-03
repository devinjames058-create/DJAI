'use strict';
// ── Financials API — SEC EDGAR companyfacts (sector-aware) with FMP fallback ──
// Primary:  SEC EDGAR companyfacts (no key required), SIC-based sector routing
// Fallback: FMP income/balance/cashflow endpoints (requires FMP_API_KEY)
// Cache keys use "v6_" prefix to bust all stale v5_ entries.

const TICKER_INDEX_URL = 'https://www.sec.gov/files/company_tickers.json';
const EDGAR_FACTS_URL  = (cik) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const EDGAR_SUBS_URL   = (cik) => `https://data.sec.gov/submissions/CIK${cik}.json`;
const FMP_BASE         = 'https://financialmodelingprep.com/api/v3';
const UA               = 'DJAI Finance dev@djai.app';
const TIMEOUT          = 15000;

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

// ── In-memory caches ──────────────────────────────────────────────────────────
const _tickerIndex      = { data: null, time: 0 }; // SEC ticker index, 24h TTL
const _submissionsCache = new Map();                // paddedCik -> { data, time }, 24h TTL
const _factsCache       = new Map();                // paddedCik -> { data, time }, 7d TTL
const _finCache         = new Map();                // 'v6_'+ticker -> { data, time }, 24h TTL

const TICKER_TTL = 24 * 60 * 60 * 1000;
const SUBS_TTL   = 24 * 60 * 60 * 1000;
const FACTS_TTL  = 7  * 24 * 60 * 60 * 1000;
const FIN_TTL    = 24 * 60 * 60 * 1000;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

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

// ── CIK resolution ────────────────────────────────────────────────────────────

async function _resolveCIK(ticker) {
  const now = Date.now();
  if (!_tickerIndex.data || (now - _tickerIndex.time > TICKER_TTL)) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const raw = await _edgarFetch(TICKER_INDEX_URL, ctrl.signal);
      clearTimeout(timer);
      const lookup = {};
      for (const entry of Object.values(raw)) {
        const key = String(entry.ticker).toUpperCase().replace(/[.\-]/g, '');
        lookup[key] = {
          cik:  String(entry.cik_str || entry.cik).padStart(10, '0'),
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
  const normalized = ticker.toUpperCase().replace(/[.\-]/g, '');
  return _tickerIndex.data[normalized] || null;
}

// ── SIC-based sector detection ────────────────────────────────────────────────

async function _detectSector(paddedCik) {
  const now    = Date.now();
  const cached = _submissionsCache.get(paddedCik);
  let   sic    = null;

  if (cached && (now - cached.time < SUBS_TTL)) {
    sic = (cached.data && cached.data.sic != null) ? cached.data.sic : null;
  } else {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const subs = await _edgarFetch(EDGAR_SUBS_URL(paddedCik), ctrl.signal);
      clearTimeout(timer);
      _submissionsCache.set(paddedCik, { data: subs, time: now });
      sic = (subs && subs.sic != null) ? subs.sic : null;
    } catch (_) {
      clearTimeout(timer);
      // Non-fatal — default to 'general'
    }
  }

  if (sic == null) return 'general';
  const n = Number(sic);
  if (n >= 6500 && n <= 6599) return 'reit';
  if (n >= 6000 && n <= 6999) return 'financial';
  if ((n >= 1000 && n <= 1499) || (n >= 2900 && n <= 2999) || (n >= 4900 && n <= 4999)) return 'energy';
  if ((n >= 2830 && n <= 2836) || (n >= 3841 && n <= 3851) || n === 5912 || (n >= 8000 && n <= 8099)) return 'healthcare';
  return 'general';
}

// ── Sector tag maps ───────────────────────────────────────────────────────────

const SECTOR_TAGS = {
  general: {
    is: {
      revenue:         ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
      costOfRevenue:   ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
      grossProfit:     ['GrossProfit'],
      rnd:             ['ResearchAndDevelopmentExpense'],
      sga:             ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
      operatingIncome: ['OperatingIncomeLoss'],
      interestExpense: ['InterestExpense', 'InterestExpenseDebt'],
      netIncome:       ['NetIncomeLoss', 'ProfitLoss'],
      eps:             ['EarningsPerShareDiluted'],
      shares:          ['WeightedAverageNumberOfDilutedSharesOutstanding', 'CommonStockSharesOutstanding'],
    },
  },
  financial: {
    is: {
      revenue:         ['Revenues', 'InterestAndDividendIncomeOperating', 'InterestIncomeExpenseNet', 'NoninterestIncome', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
      costOfRevenue:   ['InterestExpense', 'InterestExpenseDeposits'],
      grossProfit:     [],
      rnd:             [],
      sga:             ['NoninterestExpense', 'SellingGeneralAndAdministrativeExpense'],
      operatingIncome: ['OperatingIncomeLoss', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest'],
      interestExpense: ['InterestExpense', 'InterestExpenseDeposits', 'InterestExpenseBorrowings'],
      netIncome:       ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
      eps:             ['EarningsPerShareDiluted'],
      shares:          ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    },
  },
  energy: {
    is: {
      revenue:         ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'ElectricUtilityRevenue', 'OilAndGasRevenue', 'RegulatedAndUnregulatedOperatingRevenue'],
      costOfRevenue:   ['CostOfGoodsAndServicesSold', 'CostOfRevenue', 'CostOfGoodsSold', 'FuelCosts', 'CostOfNaturalGasPurchased'],
      grossProfit:     ['GrossProfit'],
      rnd:             ['ResearchAndDevelopmentExpense'],
      sga:             ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
      operatingIncome: ['OperatingIncomeLoss'],
      interestExpense: ['InterestExpense', 'InterestExpenseDebt', 'InterestCostsIncurred'],
      netIncome:       ['NetIncomeLoss', 'ProfitLoss'],
      eps:             ['EarningsPerShareDiluted'],
      shares:          ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    },
  },
  healthcare: {
    // Same structure as general — healthcare companies have standard P&L
    is: {
      revenue:         ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
      costOfRevenue:   ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
      grossProfit:     ['GrossProfit'],
      rnd:             ['ResearchAndDevelopmentExpense'],
      sga:             ['SellingGeneralAndAdministrativeExpense', 'GeneralAndAdministrativeExpense'],
      operatingIncome: ['OperatingIncomeLoss'],
      interestExpense: ['InterestExpense', 'InterestExpenseDebt'],
      netIncome:       ['NetIncomeLoss', 'ProfitLoss'],
      eps:             ['EarningsPerShareDiluted'],
      shares:          ['WeightedAverageNumberOfDilutedSharesOutstanding', 'CommonStockSharesOutstanding'],
    },
  },
  reit: {
    is: {
      revenue:         ['Revenues', 'RealEstateRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RealEstateRevenue'],
      costOfRevenue:   ['CostOfRevenue', 'RealEstateTaxExpense', 'CostOfGoodsAndServicesSold'],
      grossProfit:     ['GrossProfit'],
      rnd:             [],
      sga:             ['GeneralAndAdministrativeExpense', 'SellingGeneralAndAdministrativeExpense'],
      operatingIncome: ['OperatingIncomeLoss'],
      interestExpense: ['InterestExpense', 'InterestExpenseDebt'],
      netIncome:       ['NetIncomeLoss', 'ProfitLoss'],
      eps:             ['EarningsPerShareDiluted'],
      shares:          ['WeightedAverageNumberOfDilutedSharesOutstanding'],
    },
  },
};

// Universal BS and CF tags (same for all sectors)
const BS_TAGS = {
  cash:      ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsAndShortTermInvestments', 'Cash'],
  curAssets: ['AssetsCurrent'],
  totAssets: ['Assets'],
  curLiab:   ['LiabilitiesCurrent'],
  ltDebt:    ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'LongTermBorrowings'],
  totLiab:   ['Liabilities'],
  equity:    ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  sharesOS:  ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding'],
};

const CF_TAGS = {
  opCF:         ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByOperatingActivities'],
  capex:        ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  dividends:    ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'],
  buybacks:     ['PaymentsForRepurchaseOfCommonStock'],
  acquisitions: ['PaymentsToAcquireBusinessesNetOfCashAcquired', 'PaymentsToAcquireBusinessesGross'],
  investCF:     ['NetCashProvidedByUsedInInvestingActivities'],
  finCF:        ['NetCashProvidedByUsedInFinancingActivities', 'NetCashUsedProvidedByFinancingActivities'],
};

// Revenue tag set for verbose debug logging
const _REV_TAGS = new Set([
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax',
  'SalesRevenueNet',
  'SalesRevenueGoodsNet',
  'ElectricUtilityRevenue',
  'OilAndGasRevenue',
  'RegulatedAndUnregulatedOperatingRevenue',
  'RealEstateRevenueNet',
  'RealEstateRevenue',
  'InterestAndDividendIncomeOperating',
  'InterestIncomeExpenseNet',
  'NoninterestIncome',
]);

// ── Duration fact extraction (IS and CF items) ────────────────────────────────
// STRICT: fp must equal 'FY'. Null fp, Q4, Q1-Q3 all rejected.

function _extractDuration(facts, tags, opts) {
  const isEps    = opts ? !!opts.isEps    : false;
  const isShares = opts ? !!opts.isShares : false;
  const yearMap  = {};

  for (let ti = 0; ti < tags.length; ti++) {
    const tag    = tags[ti];
    const tagMap = {};
    const isRevTag = _REV_TAGS.has(tag);

    for (const taxonomy of ['us-gaap', 'dei']) {
      if (!facts.facts || !facts.facts[taxonomy] || !facts.facts[taxonomy][tag]) continue;
      const tagData = facts.facts[taxonomy][tag];
      if (!tagData.units) continue;

      const unitKeys = Object.keys(tagData.units);
      for (let ui = 0; ui < unitKeys.length; ui++) {
        const unit = unitKeys[ui];
        if (isEps    && unit !== 'USD/shares') continue;
        if (isShares && unit !== 'shares')     continue;
        if (!isEps && !isShares && unit !== 'USD') continue;

        const entries = tagData.units[unit];
        for (let ei = 0; ei < entries.length; ei++) {
          const entry = entries[ei];

          // 1. Annual form only
          if (!ANNUAL_FORMS.has(entry.form)) continue;

          // 2. STRICT fp filter: duration facts must be fp='FY'
          //    This is the core fix: rejects quarterly data sneaking into annual rows
          if (entry.fp !== 'FY') continue;

          // 3. Fiscal year derivation
          const fy = entry.fy != null
            ? Number(entry.fy)
            : parseInt(entry.end ? entry.end.slice(0, 4) : '', 10);
          if (!fy || isNaN(fy)) continue;

          const val   = Number(entry.val);
          const filed = entry.filed || entry.end || '';

          if (isRevTag) {
            console.log('[EDGAR rev] PASS tag=' + tag + ' form=' + entry.form + ' fp=' + entry.fp + ' fy=' + fy + ' val=' + val + ' end=' + entry.end + ' filed=' + entry.filed);
          }

          // 4. Dedup: latest filed wins for same fy/tag
          const cur = tagMap[fy];
          if (!cur || filed > (cur.filed || '')) {
            tagMap[fy] = { val: val, filed: filed, end: entry.end || null };
          }
        }
      }
    }

    if (isRevTag && Object.keys(tagMap).length > 0) {
      const fyKeys = Object.keys(tagMap).sort(function(a, b) { return Number(b) - Number(a); }).slice(0, 3);
      const summary = fyKeys.map(function(fy) { return 'FY' + fy + '=$' + (tagMap[fy].val / 1e9).toFixed(3) + 'B'; }).join(', ');
      console.log('[EDGAR] tag=' + tag + ' WINNER: ' + summary);
    }

    // Priority: first tag with data for a given fy wins
    const fyKeys = Object.keys(tagMap);
    for (let ki = 0; ki < fyKeys.length; ki++) {
      const fy   = Number(fyKeys[ki]);
      const info = tagMap[fyKeys[ki]];
      if (yearMap[fy] == null) {
        yearMap[fy] = { val: info.val, end: info.end };
        if (isRevTag) {
          console.log('[EDGAR ' + tag + '] Revenue SELECTED FY' + fy + ': $' + (info.val / 1e9).toFixed(3) + 'B');
        }
      }
    }
  }

  return yearMap;
}

// ── Instant fact extraction (BS items) ───────────────────────────────────────
// Balance sheet facts are point-in-time. fp can be 'FY' or null/undefined
// (SEC often omits fp for instant facts in annual filings).

function _extractInstant(facts, tags, opts) {
  const isShares = opts ? !!opts.isShares : false;
  const yearMap  = {};

  for (let ti = 0; ti < tags.length; ti++) {
    const tag    = tags[ti];
    const tagMap = {};

    for (const taxonomy of ['us-gaap', 'dei']) {
      if (!facts.facts || !facts.facts[taxonomy] || !facts.facts[taxonomy][tag]) continue;
      const tagData = facts.facts[taxonomy][tag];
      if (!tagData.units) continue;

      const unitKeys = Object.keys(tagData.units);
      for (let ui = 0; ui < unitKeys.length; ui++) {
        const unit = unitKeys[ui];
        if (isShares && unit !== 'shares') continue;
        if (!isShares && unit !== 'USD')   continue;

        const entries = tagData.units[unit];
        for (let ei = 0; ei < entries.length; ei++) {
          const entry = entries[ei];

          // 1. Annual form only
          if (!ANNUAL_FORMS.has(entry.form)) continue;

          // 2. Instant facts: accept fp='FY' or fp=null/undefined
          //    SEC often omits fp on balance-sheet point-in-time readings
          if (entry.fp !== 'FY' && entry.fp != null) continue;

          // 3. Fiscal year derivation
          const fy = entry.fy != null
            ? Number(entry.fy)
            : parseInt(entry.end ? entry.end.slice(0, 4) : '', 10);
          if (!fy || isNaN(fy)) continue;

          const val   = Number(entry.val);
          const filed = entry.filed || entry.end || '';

          // 4. Latest filed wins
          const cur = tagMap[fy];
          if (!cur || filed > (cur.filed || '')) {
            tagMap[fy] = { val: val, filed: filed, end: entry.end || null };
          }
        }
      }
    }

    // Priority: first tag with data for a given fy wins
    const fyKeys = Object.keys(tagMap);
    for (let ki = 0; ki < fyKeys.length; ki++) {
      const fy   = Number(fyKeys[ki]);
      const info = tagMap[fyKeys[ki]];
      if (yearMap[fy] == null) {
        yearMap[fy] = { val: info.val, end: info.end };
      }
    }
  }

  return yearMap;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _selectYears(maps) {
  const fySet = new Set();
  for (let mi = 0; mi < maps.length; mi++) {
    const m = maps[mi];
    const keys = Object.keys(m);
    for (let ki = 0; ki < keys.length; ki++) fySet.add(Number(keys[ki]));
  }
  return Array.from(fySet).sort(function(a, b) { return b - a; }).slice(0, 5);
}

function _v(map, fy) {
  const entry = map[fy];
  if (entry == null) return null;
  return (entry.val != null && isFinite(entry.val)) ? entry.val : null;
}

function _end(map, fy) {
  return (map[fy] && map[fy].end) ? map[fy].end : null;
}

function _date(maps, fy) {
  for (let mi = 0; mi < maps.length; mi++) {
    const d = _end(maps[mi], fy);
    if (d) return d;
  }
  return String(fy) + '-12-31';
}

// ── Statement builders ────────────────────────────────────────────────────────

function _buildIS(facts, sector, years) {
  const tags    = (SECTOR_TAGS[sector] || SECTOR_TAGS.general).is;
  const revenue     = _extractDuration(facts, tags.revenue, {});
  const costOfRev   = tags.costOfRevenue.length ? _extractDuration(facts, tags.costOfRevenue, {}) : {};
  const grossProfit = tags.grossProfit.length   ? _extractDuration(facts, tags.grossProfit, {})   : {};
  const rnd         = tags.rnd.length           ? _extractDuration(facts, tags.rnd, {})           : {};
  const sga         = tags.sga.length           ? _extractDuration(facts, tags.sga, {})           : {};
  const opIncome    = _extractDuration(facts, tags.operatingIncome, {});
  const intExp      = _extractDuration(facts, tags.interestExpense, {});
  const netIncome   = _extractDuration(facts, tags.netIncome, {});
  const eps         = _extractDuration(facts, tags.eps, { isEps: true });
  const dilShares   = _extractDuration(facts, tags.shares, { isShares: true });

  return years.map(function(fy) {
    const rev = _v(revenue, fy);
    const cor = _v(costOfRev, fy);
    let   gp  = _v(grossProfit, fy);
    if (gp == null && rev != null && cor != null) gp = rev - cor;
    return {
      date:         _date([revenue, netIncome], fy),
      calendarYear: String(fy),
      revenue:      rev,
      costOfRevenue: cor,
      grossProfit:  (gp != null && isFinite(gp)) ? gp : null,
      researchAndDevelopmentExpenses:          _v(rnd, fy),
      sellingGeneralAndAdministrativeExpenses: _v(sga, fy),
      operatingIncome: _v(opIncome, fy),
      interestExpense: _v(intExp, fy),
      netIncome:       _v(netIncome, fy),
      epsDiluted:      _v(eps, fy),
      weightedAverageShsOutDil: _v(dilShares, fy),
    };
  });
}

function _buildBS(facts, years) {
  const cash     = _extractInstant(facts, BS_TAGS.cash, {});
  const curAssets= _extractInstant(facts, BS_TAGS.curAssets, {});
  const totAssets= _extractInstant(facts, BS_TAGS.totAssets, {});
  const curLiab  = _extractInstant(facts, BS_TAGS.curLiab, {});
  const ltDebt   = _extractInstant(facts, BS_TAGS.ltDebt, {});
  const totLiab  = _extractInstant(facts, BS_TAGS.totLiab, {});
  const equity   = _extractInstant(facts, BS_TAGS.equity, {});
  const sharesOS = _extractInstant(facts, BS_TAGS.sharesOS, { isShares: true });

  return years.map(function(fy) {
    const totA = _v(totAssets, fy);
    const totL = _v(totLiab, fy);
    let   eq   = _v(equity, fy);
    if (eq == null && totA != null && totL != null) eq = totA - totL;
    const eqFinal = (eq != null && isFinite(eq)) ? eq : null;
    let bvps = null;
    if (eqFinal != null) {
      const sh = _v(sharesOS, fy);
      if (sh != null && sh !== 0) bvps = eqFinal / sh;
    }
    return {
      date:                    _date([totAssets, equity], fy),
      calendarYear:            String(fy),
      cashAndCashEquivalents:  _v(cash, fy),
      totalCurrentAssets:      _v(curAssets, fy),
      totalAssets:             totA,
      totalCurrentLiabilities: _v(curLiab, fy),
      longTermDebt:            _v(ltDebt, fy),
      totalLiabilities:        totL,
      totalStockholdersEquity: eqFinal,
      bookValuePerShare:       (bvps != null && isFinite(bvps)) ? bvps : null,
    };
  });
}

function _buildCF(facts, years) {
  const opCF        = _extractDuration(facts, CF_TAGS.opCF, {});
  const capex       = _extractDuration(facts, CF_TAGS.capex, {});
  const dividends   = _extractDuration(facts, CF_TAGS.dividends, {});
  const buybacks    = _extractDuration(facts, CF_TAGS.buybacks, {});
  const acquisitions= _extractDuration(facts, CF_TAGS.acquisitions, {});
  const investCF    = _extractDuration(facts, CF_TAGS.investCF, {});
  const finCF       = _extractDuration(facts, CF_TAGS.finCF, {});

  return years.map(function(fy) {
    const opCFv    = _v(opCF, fy);
    const capexRaw = _v(capex, fy);
    const capexv   = capexRaw != null ? -Math.abs(capexRaw) : null;
    const fcf      = (opCFv != null && capexRaw != null) ? opCFv - Math.abs(capexRaw) : null;
    const acqRaw   = _v(acquisitions, fy);
    const divRaw   = _v(dividends, fy);
    const buyRaw   = _v(buybacks, fy);
    return {
      date:                   _date([opCF, investCF], fy),
      calendarYear:           String(fy),
      operatingCashFlow:      opCFv,
      capitalExpenditure:     capexv,
      freeCashFlow:           (fcf != null && isFinite(fcf)) ? fcf : null,
      acquisitionsNet:        acqRaw != null ? -Math.abs(acqRaw) : null,
      dividendsPaid:          divRaw != null ? -Math.abs(divRaw) : null,
      commonStockRepurchased: buyRaw != null ? -Math.abs(buyRaw) : null,
      netCashProvidedByUsedInInvestingActivities: _v(investCF, fy),
      netCashUsedProvidedByFinancingActivities:   _v(finCF, fy),
    };
  });
}

// ── EDGAR quality check ───────────────────────────────────────────────────────

function _edgarQualityOk(incomeStatement) {
  const IS_KEY_FIELDS = ['revenue', 'netIncome', 'operatingIncome'];
  let filled = 0;
  for (let fi = 0; fi < IS_KEY_FIELDS.length; fi++) {
    const f = IS_KEY_FIELDS[fi];
    if (incomeStatement.some(function(r) { return r[f] != null; })) filled++;
  }
  return filled >= 2;
}

// ── Companyfacts fetch ────────────────────────────────────────────────────────

async function _getCompanyFacts(paddedCik) {
  const cached = _factsCache.get(paddedCik);
  if (cached && (Date.now() - cached.time < FACTS_TTL)) return cached.data;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const data = await _edgarFetch(EDGAR_FACTS_URL(paddedCik), ctrl.signal);
    clearTimeout(timer);
    _factsCache.set(paddedCik, { data: data, time: Date.now() });
    return data;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── EDGAR attempt ─────────────────────────────────────────────────────────────

async function _tryEdgar(ticker) {
  const entry = await _resolveCIK(ticker);
  if (!entry) return null;

  const cik        = entry.cik;
  const entityName = entry.name;

  // Fetch sector (SIC) and companyfacts in parallel
  const results = await Promise.all([
    _detectSector(cik),
    _getCompanyFacts(cik),
  ]);
  const sector = results[0];
  const facts  = results[1];

  console.log('[EDGAR ' + ticker + '] sector=' + sector + ' cik=' + cik);

  // Year selection anchored on revenue + assets + opCF
  const revTags    = (SECTOR_TAGS[sector] || SECTOR_TAGS.general).is.revenue;
  const revenueMap = _extractDuration(facts, revTags, {});
  const assetsMap  = _extractInstant(facts, BS_TAGS.totAssets, {});
  const opCFMap    = _extractDuration(facts, CF_TAGS.opCF, {});

  const years = _selectYears([revenueMap, assetsMap, opCFMap]);
  if (!years.length) return null;

  const incomeStatement = _buildIS(facts, sector, years);
  const balanceSheet    = _buildBS(facts, years);
  const cashFlow        = _buildCF(facts, years);

  if (!incomeStatement.length && !balanceSheet.length && !cashFlow.length) return null;

  if (!_edgarQualityOk(incomeStatement)) {
    console.log('[EDGAR ' + ticker + '] quality check failed — deferring to FMP');
    return null;
  }

  return {
    entity: entityName,
    ticker: ticker,
    cik:    cik.replace(/^0+/, ''),
    source: 'SEC EDGAR (10-K)',
    incomeStatement: incomeStatement,
    balanceSheet:    balanceSheet,
    cashFlow:        cashFlow,
  };
}

// ── FMP fallback ──────────────────────────────────────────────────────────────

function _normFmpIS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(function(r) {
    return {
      date:              r.date              != null ? r.date              : null,
      calendarYear:      r.calendarYear      != null ? r.calendarYear      : null,
      revenue:           r.revenue           != null ? r.revenue           : null,
      costOfRevenue:     r.costOfRevenue     != null ? r.costOfRevenue     : null,
      grossProfit:       r.grossProfit       != null ? r.grossProfit       : null,
      researchAndDevelopmentExpenses:          r.researchAndDevelopmentExpenses          != null ? r.researchAndDevelopmentExpenses          : null,
      sellingGeneralAndAdministrativeExpenses: r.sellingGeneralAndAdministrativeExpenses != null ? r.sellingGeneralAndAdministrativeExpenses : null,
      operatingIncome:   r.operatingIncome   != null ? r.operatingIncome   : null,
      interestExpense:   r.interestExpense   != null ? r.interestExpense   : null,
      netIncome:         r.netIncome         != null ? r.netIncome         : null,
      epsDiluted:        r.epsDiluted        != null ? r.epsDiluted        : null,
      weightedAverageShsOutDil: r.weightedAverageShsOutDil != null ? r.weightedAverageShsOutDil : null,
    };
  });
}

function _normFmpBS(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(function(r) {
    return {
      date:                    r.date                    != null ? r.date                    : null,
      calendarYear:            r.calendarYear            != null ? r.calendarYear            : null,
      cashAndCashEquivalents:  r.cashAndCashEquivalents  != null ? r.cashAndCashEquivalents  : null,
      totalCurrentAssets:      r.totalCurrentAssets      != null ? r.totalCurrentAssets      : null,
      totalAssets:             r.totalAssets             != null ? r.totalAssets             : null,
      totalCurrentLiabilities: r.totalCurrentLiabilities != null ? r.totalCurrentLiabilities : null,
      longTermDebt:            r.longTermDebt            != null ? r.longTermDebt            : null,
      totalLiabilities:        r.totalLiabilities        != null ? r.totalLiabilities        : null,
      totalStockholdersEquity: r.totalStockholdersEquity != null ? r.totalStockholdersEquity : null,
      bookValuePerShare:       r.bookValuePerShare        != null ? r.bookValuePerShare        : null,
    };
  });
}

function _normFmpCF(arr) {
  return (Array.isArray(arr) ? arr : []).slice(0, 5).map(function(r) {
    return {
      date:                   r.date                   != null ? r.date                   : null,
      calendarYear:           r.calendarYear           != null ? r.calendarYear           : null,
      operatingCashFlow:      r.operatingCashFlow      != null ? r.operatingCashFlow      : null,
      capitalExpenditure:     r.capitalExpenditure     != null ? r.capitalExpenditure     : null,
      freeCashFlow:           r.freeCashFlow           != null ? r.freeCashFlow           : null,
      acquisitionsNet:        r.acquisitionsNet        != null ? r.acquisitionsNet        : null,
      dividendsPaid:          r.dividendsPaid          != null ? r.dividendsPaid          : null,
      commonStockRepurchased: r.commonStockRepurchased != null ? r.commonStockRepurchased : null,
      netCashProvidedByUsedInInvestingActivities: r.netCashProvidedByUsedInInvestingActivities != null ? r.netCashProvidedByUsedInInvestingActivities : null,
      netCashUsedProvidedByFinancingActivities:   r.netCashUsedProvidedByFinancingActivities   != null ? r.netCashUsedProvidedByFinancingActivities   : null,
    };
  });
}

async function _tryFmp(ticker) {
  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return null;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const all = await Promise.all([
      _fmpFetch('/income-statement/' + encodeURIComponent(ticker) + '?limit=5', KEY, ctrl.signal),
      _fmpFetch('/balance-sheet-statement/' + encodeURIComponent(ticker) + '?limit=5', KEY, ctrl.signal),
      _fmpFetch('/cash-flow-statement/' + encodeURIComponent(ticker) + '?limit=5', KEY, ctrl.signal),
    ]);
    clearTimeout(timer);

    const isRaw = all[0];
    const bsRaw = all[1];
    const cfRaw = all[2];

    const incomeStatement = _normFmpIS(isRaw || []);
    const balanceSheet    = _normFmpBS(bsRaw || []);
    const cashFlow        = _normFmpCF(cfRaw || []);
    if (!incomeStatement.length && !balanceSheet.length && !cashFlow.length) return null;

    return {
      entity: (Array.isArray(isRaw) && isRaw[0] && isRaw[0].symbol) ? isRaw[0].symbol : ticker,
      ticker: ticker,
      source: 'FMP (SEC filings)',
      incomeStatement: incomeStatement,
      balanceSheet:    balanceSheet,
      cashFlow:        cashFlow,
    };
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let ticker = ((req.query && req.query.ticker) || '').trim().toUpperCase();
  if (!ticker && req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) {} }
    ticker = ((body && body.ticker) || '').trim().toUpperCase();
  }
  if (!ticker) return res.status(400).json({ ok: false, error: 'ticker required' });

  // Cache check — v6_ busts all prior versions
  const cacheKey = 'v6_' + ticker;
  const cached   = _finCache.get(cacheKey);
  if (cached && (Date.now() - cached.time < FIN_TTL)) {
    return res.status(200).json(Object.assign({ ok: true, cached: true }, cached.data));
  }

  // Stage 1: Try SEC EDGAR
  let payload = null;
  let lastErr = null;

  try {
    payload = await _tryEdgar(ticker);
  } catch (e) {
    lastErr = e;
    console.log('[financials] EDGAR error for ' + ticker + ': ' + e.message);
  }

  // Stage 2: FMP fallback if EDGAR returned nothing or failed quality check
  if (!payload) {
    try {
      payload = await _tryFmp(ticker);
    } catch (e) {
      if (!lastErr) lastErr = e;
    }
  }

  // Stage 3: Both failed
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

  // Cache and return
  const hasData = payload.incomeStatement.length > 0
    || payload.balanceSheet.length > 0
    || payload.cashFlow.length > 0;
  if (hasData) {
    _finCache.set(cacheKey, { data: payload, time: Date.now() });
  }

  return res.status(200).json(Object.assign({ ok: true, cached: false }, payload));
};
