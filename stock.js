// Serverless endpoint: GET /api/stock?symbol=TSLA
// Pulls everything from Yahoo Finance (no API keys) and returns it in the shape the frontend expects.

const n = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const pc = (v) => (n(v) == null ? null : v * 100);
const toDate = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : typeof d === "string" ? d.slice(0, 10) : null);
const ok = (v) => ({ ok: true, v });
const bad = (e) => ({ ok: false, e: String((e && e.message) || e) });
const settle = async (p) => { try { return ok(await p); } catch (e) { return bad(e); } };
const LOOSE = { validateResult: false };

function mapMetric(s) {
  const sd = s.summaryDetail || {}, ks = s.defaultKeyStatistics || {}, fd = s.financialData || {}, pr = s.price || {};
  const cash = n(fd.totalCash), debt = n(fd.totalDebt);
  return {
    peTTM: n(sd.trailingPE),
    forwardPE: n(sd.forwardPE) ?? n(ks.forwardPE),
    psTTM: n(sd.priceToSalesTrailing12Months),
    pbQuarterly: n(ks.priceToBook),
    evEbitdaTTM: n(ks.enterpriseToEbitda),
    pegRatio: n(ks.pegRatio),
    revenueGrowthTTMYoy: pc(fd.revenueGrowth),
    epsGrowthTTMYoy: pc(fd.earningsGrowth),
    grossMarginTTM: pc(fd.grossMargins),
    operatingMarginTTM: pc(fd.operatingMargins),
    netProfitMarginTTM: pc(fd.profitMargins),
    roeTTM: pc(fd.returnOnEquity),
    roaTTM: pc(fd.returnOnAssets),
    "totalDebt/totalEquityQuarterly": n(fd.debtToEquity) == null ? null : fd.debtToEquity / 100,
    currentRatioQuarterly: n(fd.currentRatio),
    freeCashFlowTTM: n(fd.freeCashflow),
    operatingCashFlowTTM: n(fd.operatingCashflow),
    totalCash: cash,
    totalDebt: debt,
    netDebt: cash != null && debt != null ? debt - cash : null,
    beta: n(sd.beta) ?? n(ks.beta),
    dividendYieldIndicatedAnnual: pc(sd.dividendYield),
    shortPercentFloat: pc(ks.shortPercentOfFloat),
    "52WeekHigh": n(sd.fiftyTwoWeekHigh),
    "52WeekLow": n(sd.fiftyTwoWeekLow),
    marketCapitalization: n(pr.marketCap) != null ? pr.marketCap / 1e6 : null,
  };
}

function mapInsiders(s) {
  const list = s.insiderTransactions && s.insiderTransactions.transactions;
  if (!Array.isArray(list)) return bad("No insider data returned");
  const data = list.map((t) => {
    const text = t.transactionText || "";
    const code = /^purchase/i.test(text) ? "P" : /^sale/i.test(text) ? "S" : "O";
    const shares = n(t.shares), value = n(t.value);
    const fromText = (text.match(/price\s+([\d.]+)/i) || [])[1];
    const px = shares && value ? value / shares : n(parseFloat(fromText));
    return { name: t.filerName, relation: t.filerRelation, transactionDate: toDate(t.startDate), transactionCode: code, change: code === "S" ? -(shares || 0) : shares || 0, transactionPrice: px || null };
  }).filter((x) => x.transactionDate);
  return ok({ data });
}

function mapOwnership(s) {
  const list = s.institutionOwnership && s.institutionOwnership.ownershipList;
  if (!Array.isArray(list) || !list.length) return bad("No institutional data returned");
  const rows = list.map((h) => {
    const pos = n(h.position) || 0, p = n(h.pctChange);
    return { name: h.organization, share: pos, change: p == null ? 0 : Math.round(pos - pos / (1 + p)) };
  });
  return ok({ ownership: rows });
}

async function buildOptions(yf, sym) {
  const first = await yf.options(sym, {}, LOOSE);
  const exps = first.expirationDates || [];
  const chains = first.options && first.options[0] ? [first.options[0]] : [];
  if (exps[1]) {
    try {
      const second = await yf.options(sym, { date: exps[1] }, LOOSE);
      if (second.options && second.options[0]) chains.push(second.options[0]);
    } catch {}
  }
  let callVol = 0, putVol = 0, callOI = 0, putOI = 0, callPrem = 0, putPrem = 0;
  const unusual = [];
  for (const c of chains) {
    for (const [side, arr] of [["call", c.calls || []], ["put", c.puts || []]]) {
      for (const o of arr) {
        const v = n(o.volume) || 0, oi = n(o.openInterest) || 0, px = n(o.lastPrice) || 0;
        if (side === "call") { callVol += v; callOI += oi; callPrem += v * px * 100; }
        else { putVol += v; putOI += oi; putPrem += v * px * 100; }
        if (v >= 500 && oi > 0 && v / oi >= 1.5) unusual.push({ type: side, strike: o.strike, expiry: toDate(c.expirationDate), volume: v, oi, iv: n(o.impliedVolatility), last: px });
      }
    }
  }
  if (!callVol && !putVol && !callOI && !putOI) throw new Error("Options chain empty");
  unusual.sort((a, b) => b.volume - a.volume);
  unusual.length = Math.min(unusual.length, 8);
  return {
    expiries: chains.map((c) => toDate(c.expirationDate)).filter(Boolean),
    callVol, putVol, callOI, putOI,
    pcrVol: callVol ? putVol / callVol : null,
    pcrOI: callOI ? putOI / callOI : null,
    callPrem, putPrem, unusual,
  };
}

export async function buildPayload(yf, sym) {
  const now = Date.now();
  const [sum, chart, search, opt] = await Promise.all([
    settle(yf.quoteSummary(sym, { modules: ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "assetProfile", "recommendationTrend", "insiderTransactions", "institutionOwnership", "calendarEvents"] }, LOOSE)),
    settle(yf.chart(sym, { period1: new Date(now - 460 * 864e5), interval: "1d" }, LOOSE)),
    settle(yf.search(sym, { newsCount: 8, quotesCount: 0 }, LOOSE)),
    settle(buildOptions(yf, sym)),
  ]);
  if (!sum.ok) return { error: "No data found for " + sym + " (" + sum.e + ")" };
  const s = sum.v;
  const pr = s.price || {};
  const price = n(pr.regularMarketPrice);
  if (price == null) return { error: "No quote found for " + sym + "." };

  const quote = ok({
    c: price,
    d: n(pr.regularMarketChange) ?? 0,
    dp: pc(pr.regularMarketChangePercent) ?? 0,
    h: n(pr.regularMarketDayHigh), l: n(pr.regularMarketDayLow), pc: n(pr.regularMarketPreviousClose),
    t: pr.regularMarketTime instanceof Date ? Math.floor(pr.regularMarketTime.getTime() / 1000) : null,
  });
  const profile = ok({ name: pr.longName || pr.shortName || sym, exchange: pr.exchangeName, finnhubIndustry: (s.assetProfile && (s.assetProfile.industry || s.assetProfile.sector)) || "" });
  const metric = ok({ metric: mapMetric(s) });

  const trend = s.recommendationTrend && s.recommendationTrend.trend && s.recommendationTrend.trend[0];
  const rec = trend ? ok([{ strongBuy: trend.strongBuy || 0, buy: trend.buy || 0, hold: trend.hold || 0, sell: trend.sell || 0, strongSell: trend.strongSell || 0, period: trend.period || "" }]) : bad("No recommendation data");
  const fd = s.financialData || {};
  const target = n(fd.targetMeanPrice) ? ok({ targetMean: fd.targetMeanPrice, targetLow: n(fd.targetLowPrice), targetHigh: n(fd.targetHighPrice), analysts: n(fd.numberOfAnalystOpinions) }) : bad("No analyst targets");

  let earnings = bad("No earnings date");
  const ed = s.calendarEvents && s.calendarEvents.earnings && s.calendarEvents.earnings.earningsDate;
  if (Array.isArray(ed) && ed[0]) earnings = ok({ earningsCalendar: [{ date: toDate(ed[0]), epsEstimate: n(s.calendarEvents.earnings.earningsAverage) }] });

  let candles = bad(chart.ok ? "No price history" : chart.e);
  if (chart.ok && Array.isArray(chart.v.quotes)) {
    const values = chart.v.quotes.filter((q) => n(q.close) != null && n(q.high) != null && n(q.low) != null)
      .map((q) => ({ datetime: toDate(q.date), open: String(q.open), high: String(q.high), low: String(q.low), close: String(q.close) })).reverse();
    if (values.length) candles = ok({ values });
  }

  let news = bad(search.ok ? "No news" : search.e);
  if (search.ok && Array.isArray(search.v.news)) {
    news = ok(search.v.news.slice(0, 8).map((x) => ({ headline: x.title, url: x.link, source: x.publisher, datetime: x.providerPublishTime instanceof Date ? Math.floor(x.providerPublishTime.getTime() / 1000) : Math.floor(Date.now() / 1000) })));
  }

  return {
    quote, profile, metric, rec, target, earnings, candles, news,
    insiders: mapInsiders(s),
    ownership: mapOwnership(s),
    options: opt,
    congress: bad("No free source for congressional trades is wired in"),
  };
}

export default async function handler(req, res) {
  const sym = String((req.query && req.query.symbol) || "").toUpperCase().replace(/[^A-Z0-9.\-^=]/g, "").slice(0, 12);
  if (!sym) return res.status(400).json({ error: "Missing symbol" });
  try {
    const mod = await import("yahoo-finance2");
    const YahooFinance = mod.default;
    const yf = typeof YahooFinance === "function" ? new YahooFinance({ suppressNotices: ["yahooSurvey"] }) : YahooFinance;
    const payload = await buildPayload(yf, sym);
    if (payload.error) return res.status(404).json({ error: payload.error });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(payload);
  } catch (e) {
    return res.status(502).json({ error: "Data source error: " + ((e && e.message) || e) });
  }
}
