// .github/scripts/scan.js
// Runs via GitHub Actions — fetches NSE stock data, computes RSI+MACD+EMA,
// saves strong signals (>= 85% confidence) to JSONBin

const https = require('https');

const JSONBIN_ID  = process.env.JSONBIN_ID;   // set in GitHub Secrets
const JSONBIN_KEY = process.env.JSONBIN_KEY;  // set in GitHub Secrets
const MIN_CONF    = 85;

// 100 NSE stocks
const STOCKS = [
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','SBIN','AXISBANK',
  'TATAMOTORS','ADANIENT','WIPRO','BAJFINANCE','MARUTI','SUNPHARMA','NESTLEIND',
  'ONGC','NTPC','POWERGRID','COALINDIA','LT','BAJAJFINSV','TECHM','HCLTECH',
  'ULTRACEMCO','TITAN','ASIANPAINT','BAJAJ-AUTO','HEROMOTOCO','EICHERMOT','TATACONSUM',
  'ADANIPORTS','APOLLOHOSP','BHARTIARTL','BPCL','BRITANNIA','CIPLA','DRREDDY',
  'GRASIM','HAVELLS','HINDALCO','INDUSINDBK','ITC','JSWSTEEL','KOTAKBANK','M&M',
  'TATASTEEL','TATAPOWER','VEDL','ZOMATO','BANKBARODA','PNB','CANBK','IDFCFIRSTB',
  'FEDERALBNK','YESBANK','IRFC','RECLTD','PFC','MUTHOOTFIN','CHOLAFIN','AUROPHARMA',
  'LUPIN','BIOCON','AMBUJACEM','ACC','IOCL','HINDPETRO','GAIL','NHPC','RVNL',
  'BEL','HAL','BHEL','SUZLON','TRENT','DMART','SAIL','SIEMENS','TORNTPHARM',
  'DIVISLAB','PIDILITIND','SHRIRAMFIN','VOLTAS','ADANIGREEN','ADANIPOWER','SJVN',
  'IRCON','MANKIND','ZYDUSLIFE','ALKEM','SBICARD','BANDHANBNK','KARURVYSYA',
  'RBLBANK','OIL','PAGEIND','UNIONBANK','SHREECEM'
];

// ── HTTP GET helper ──────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse failed: ' + data.slice(0,100))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Technical Indicators ─────────────────────────────────
function calcRSI(c, p = 14) {
  if (c.length < p + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i-1]; d > 0 ? g += d : l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i-1], gn = d > 0 ? d : 0, ln = d < 0 ? -d : 0;
    ag = (ag*(p-1)+gn)/p; al = (al*(p-1)+ln)/p;
  }
  return al === 0 ? 100 : parseFloat((100 - 100/(1 + ag/al)).toFixed(2));
}

function emaArr(data, p) {
  const k = 2/(p+1), r = new Array(data.length).fill(null);
  let s = 0, ct = 0;
  for (let i = 0; i < data.length; i++) {
    s += data[i]; ct++;
    if (ct === p) r[i] = s/p;
    else if (ct > p && r[i-1] !== null) r[i] = data[i]*k + r[i-1]*(1-k);
  }
  return r;
}

function calcEMA(data, p) {
  const a = emaArr(data, p);
  for (let i = a.length-1; i >= 0; i--) if (a[i] !== null) return +a[i].toFixed(4);
  return null;
}

function calcMACD(c) {
  if (c.length < 27) return null;
  const e12 = emaArr(c, 12), e26 = emaArr(c, 26);
  const ml = [];
  for (let i = 0; i < c.length; i++) if (e12[i] !== null && e26[i] !== null) ml.push(e12[i] - e26[i]);
  if (ml.length < 9) return null;
  const sig = emaArr(ml, 9);
  const last = ml.length - 1;
  const macd = ml[last], signal = sig[last], hist = macd - signal;
  const prevHist = ml[last-1] - (sig[last-1] || 0);
  return { macd: +macd.toFixed(4), signal: +signal.toFixed(4), hist: +hist.toFixed(4), prevHist: +prevHist.toFixed(4) };
}

function calcATR(c, p = 14) {
  if (c.length < p + 1) return c[c.length-1] * 0.012;
  let trs = [];
  for (let i = 1; i < c.length; i++) trs.push(Math.abs(c[i] - c[i-1]));
  return trs.slice(-p).reduce((a,b) => a+b, 0) / p;
}

// ── Signal Logic ─────────────────────────────────────────
function computeSignal(closes, price) {
  if (!closes || closes.length < 30) return null;
  const rsi  = calcRSI(closes, 14);
  const ema  = calcEMA(closes, 9);
  const macd = calcMACD(closes);
  if (rsi === null || ema === null || macd === null) return null;

  const rsiSig  = rsi < 38 ? 'BUY' : rsi > 62 ? 'SELL' : 'NEUTRAL';
  const emaSig  = price > ema ? 'BUY' : 'SELL';
  const macdSig = macd.hist > 0 && macd.hist > macd.prevHist ? 'BUY'
                : macd.hist < 0 && macd.hist < macd.prevHist ? 'SELL' : 'NEUTRAL';

  let score = 0;
  if (rsiSig  === 'BUY')  score += 35; if (rsiSig  === 'SELL') score -= 35;
  if (emaSig  === 'BUY')  score += 30; if (emaSig  === 'SELL') score -= 30;
  if (macdSig === 'BUY')  score += 35; if (macdSig === 'SELL') score -= 35;
  if (rsi < 30) score += 12; if (rsi > 70) score -= 12;
  if (rsi < 25) score += 8;  if (rsi > 75) score -= 8;
  if (macd.macd > 0 && macd.signal < 0) score += 8;
  if (macd.macd < 0 && macd.signal > 0) score -= 8;

  const confidence = Math.min(97, Math.max(5, Math.abs(score)));
  const direction  = score >= MIN_CONF * 0.85 ? 'BUY' : score <= -MIN_CONF * 0.85 ? 'SELL' : 'NEUTRAL';
  if (confidence < MIN_CONF || direction === 'NEUTRAL') return null;

  const atr    = calcATR(closes, 14);
  const target = direction === 'BUY' ? +(price + atr*2).toFixed(2) : +(price - atr*2).toFixed(2);
  const sl     = direction === 'BUY' ? +(price - atr*1).toFixed(2) : +(price + atr*1).toFixed(2);
  const reward = Math.abs(target - price), risk = Math.abs(sl - price);
  const rr     = risk > 0 ? '1:' + (reward/risk).toFixed(1) : '—';
  const allAgree = (rsiSig === emaSig && emaSig === macdSig && rsiSig !== 'NEUTRAL');

  const reasons = [];
  if (rsiSig  === 'BUY')  reasons.push(`RSI ${rsi} oversold`);
  if (rsiSig  === 'SELL') reasons.push(`RSI ${rsi} overbought`);
  if (emaSig  === 'BUY')  reasons.push(`Price above EMA9`);
  if (emaSig  === 'SELL') reasons.push(`Price below EMA9`);
  if (macdSig === 'BUY')  reasons.push(`MACD histogram rising`);
  if (macdSig === 'SELL') reasons.push(`MACD histogram falling`);

  return { rsi, ema: +ema.toFixed(2), macd, rsiSig, emaSig, macdSig,
           direction, confidence, allAgree, entry: price, target, sl, rr,
           reason: reasons.join(' · ') };
}

// ── Fetch one stock ──────────────────────────────────────
async function fetchStock(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}.NS?interval=1d&range=60d`;
  try {
    const json = await get(url);
    if (!json?.chart?.result?.[0]) throw new Error('no result');
    const res    = json.chart.result[0];
    const closes = (res.indicators.quote[0].close || []).filter(c => c != null);
    const meta   = res.meta;
    return { closes, price: meta.regularMarketPrice, prev: meta.chartPreviousClose,
             hi: meta.regularMarketDayHigh, lo: meta.regularMarketDayLow,
             vol: meta.regularMarketVolume };
  } catch(e) {
    // Try query2 as fallback
    try {
      const url2 = url.replace('query1','query2');
      const json2 = await get(url2);
      if (!json2?.chart?.result?.[0]) throw new Error('no result');
      const res    = json2.chart.result[0];
      const closes = (res.indicators.quote[0].close || []).filter(c => c != null);
      const meta   = res.meta;
      return { closes, price: meta.regularMarketPrice, prev: meta.chartPreviousClose,
               hi: meta.regularMarketDayHigh, lo: meta.regularMarketDayLow,
               vol: meta.regularMarketVolume };
    } catch(e2) { return null; }
  }
}

// ── Save to JSONBin ──────────────────────────────────────
function saveToJSONBin(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'api.jsonbin.io',
      path: `/v3/b/${JSONBIN_ID}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_KEY,
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => {
        console.log('JSONBin response:', res.statusCode, d.slice(0,100));
        resolve(res.statusCode);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────
async function main() {
  const now  = new Date();
  const date = now.toISOString().slice(0, 10);
  console.log(`\n=== NSE Signal Scan — ${date} ===\n`);

  const signals = [];
  let scanned = 0, buys = 0, sells = 0;

  // Batch 8 at a time to avoid rate limiting
  const BATCH = 8;
  for (let i = 0; i < STOCKS.length; i += BATCH) {
    const batch = STOCKS.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (sym) => {
      const data = await fetchStock(sym);
      scanned++;
      if (!data) return;
      const sig = computeSignal(data.closes, data.price);
      if (!sig) return;
      const chgPct = ((data.price - data.prev) / data.prev * 100);
      signals.push({
        sym, direction: sig.direction, confidence: sig.confidence,
        rsi: sig.rsi, ema: sig.ema, macd: sig.macd,
        rsiSig: sig.rsiSig, emaSig: sig.emaSig, macdSig: sig.macdSig,
        allAgree: sig.allAgree, entry: sig.entry, target: sig.target,
        sl: sig.sl, rr: sig.rr, reason: sig.reason,
        price: data.price, prev: data.prev, chgPct: +chgPct.toFixed(2),
        hi: data.hi, lo: data.lo, vol: data.vol,
        scanTime: now.toISOString()
      });
      if (sig.direction === 'BUY')  buys++;
      if (sig.direction === 'SELL') sells++;
      console.log(`  ${sig.direction} ${sym} — RSI:${sig.rsi} Conf:${sig.confidence}%`);
    }));
    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  const result = {
    date, scannedAt: now.toISOString(),
    scanned, buy: buys, sell: sells, total: signals.length,
    signals: signals.sort((a,b) => b.confidence - a.confidence)
  };

  console.log(`\nScanned: ${scanned} | BUY: ${buys} | SELL: ${sells} | Strong signals: ${signals.length}`);
  console.log('Saving to JSONBin...');
  await saveToJSONBin(result);
  console.log('Done!');
}

main().catch(err => { console.error(err); process.exit(1); });