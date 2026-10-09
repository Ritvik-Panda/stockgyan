
 // StockGyan — Advanced Technical Indicator Engine
 // Stored D1 candles -> indicators -> D1
 // No direct Upstox calls.
 //
 // Endpoint: POST /api/market/technical-indicator-refresh
 // Header: X-Refresh-Secret: TECHNICAL_REFRESH_SECRET

const MAX_STOCKS = 5;
const MIN_CANDLES = 50;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sma(values, period) {
  if (values.length < period) return null;
  return average(values.slice(-period));
}

function emaSeries(values, period) {
  const result = new Array(values.length).fill(null);

  if (values.length < period) return result;

  const first = average(values.slice(0, period));
  if (first === null) return result;

  result[period - 1] = first;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    result[i] =
      values[i] * multiplier +
      result[i - 1] * (1 - multiplier);
  }

  return result;
}

function lastEMA(values, period) {
  const series = emaSeries(values, period);
  return series.length ? series[series.length - 1] : null;
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    avgGain =
      (avgGain * (period - 1) + Math.max(change, 0)) / period;

    avgLoss =
      (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes) {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);
  const macdSeries = [];

  for (let i = 0; i < closes.length; i++) {
    if (fast[i] !== null && slow[i] !== null) {
      macdSeries.push(fast[i] - slow[i]);
    }
  }

  if (!macdSeries.length) {
    return { macd: null, signal: null, histogram: null };
  }

  const signalSeries = emaSeries(macdSeries, 9);
  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];

  return {
    macd,
    signal,
    histogram: signal === null ? null : macd - signal
  };
}

function calculateStochastic(highs, lows, closes, period = 14, smooth = 3) {
  if (closes.length < period) {
    return { k: null, d: null };
  }

  const kSeries = [];

  for (let i = period - 1; i < closes.length; i++) {
    const start = i - period + 1;
    const highest = Math.max(...highs.slice(start, i + 1));
    const lowest = Math.min(...lows.slice(start, i + 1));
    const range = highest - lowest;

    kSeries.push(
      range === 0 ? 50 : ((closes[i] - lowest) / range) * 100
    );
  }

  return {
    k: kSeries[kSeries.length - 1],
    d: kSeries.length >= smooth
      ? average(kSeries.slice(-smooth))
      : null
  };
}

function calculateBollinger(closes, period = 20, multiplier = 2) {
  if (closes.length < period) {
    return { middle: null, upper: null, lower: null, width: null };
  }

  const values = closes.slice(-period);
  const middle = average(values);

  const variance = average(
    values.map(value => Math.pow(value - middle, 2))
  );

  const sd = Math.sqrt(variance);

  const upper = middle + multiplier * sd;
  const lower = middle - multiplier * sd;

  return {
    middle,
    upper,
    lower,
    width: middle !== 0 ? ((upper - lower) / middle) * 100 : null
  };
}

function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length <= period) return null;

  const tr = [];

  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  if (tr.length < period) return null;

  let atr = average(tr.slice(0, period));

  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }

  return atr;
}

function calculateADX(highs, lows, closes, period = 14) {
  if (closes.length < period * 2 + 1) {
    return { adx: null, plusDI: null, minusDI: null };
  }

  const tr = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < closes.length; i++) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];

    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));

    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }

  let smoothTR = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
  let smoothMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

  const dxSeries = [];
  let latestPlusDI = null;
  let latestMinusDI = null;

  for (let i = period - 1; i < tr.length; i++) {
    if (i >= period) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlus = smoothPlus - smoothPlus / period + plusDM[i];
      smoothMinus = smoothMinus - smoothMinus / period + minusDM[i];
    }

    if (smoothTR <= 0) continue;

    latestPlusDI = 100 * smoothPlus / smoothTR;
    latestMinusDI = 100 * smoothMinus / smoothTR;

    const denominator = latestPlusDI + latestMinusDI;

    dxSeries.push(
      denominator === 0
        ? 0
        : 100 * Math.abs(latestPlusDI - latestMinusDI) / denominator
    );
  }

  if (dxSeries.length < period) {
    return { adx: null, plusDI: latestPlusDI, minusDI: latestMinusDI };
  }

  let adx = average(dxSeries.slice(0, period));

  for (let i = period; i < dxSeries.length; i++) {
    adx = (adx * (period - 1) + dxSeries[i]) / period;
  }

  return { adx, plusDI: latestPlusDI, minusDI: latestMinusDI };
}

function calculateOBV(closes, volumes) {
  if (!closes.length) return null;

  let obv = 0;

  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
  }

  return obv;
}

function parseCandles(raw) {
  const arr = Array.isArray(raw) ? raw : [];

  return arr.map(c => {
    const isArray = Array.isArray(c);
    const rawTime = isArray ? c[0] : c.time;

    const ms = typeof rawTime === "number"
      ? (rawTime > 1e12 ? rawTime : rawTime * 1000)
      : new Date(rawTime).getTime();

    return {
      time: Math.floor(ms / 1000),
      open: num(isArray ? c[1] : c.open),
      high: num(isArray ? c[2] : c.high),
      low: num(isArray ? c[3] : c.low),
      close: num(isArray ? c[4] : c.close),
      volume: num(isArray ? c[5] : c.volume) || 0
    };
  })
    .filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    )
    .sort((a, b) => a.time - b.time);
}

async function getStoredCandles(env, instrumentKey) {
  const row = await env.DB.prepare(`
    SELECT instrument_key, symbol, company_name, isin, exchange,
           candles_json, candle_count, latest_candle_time,
           data_status, updated_at
    FROM technical_chart_data
    WHERE instrument_key = ? AND interval = '1d'
    LIMIT 1
  `).bind(instrumentKey).first();

  if (!row) return null;

  let raw = [];

  try {
    raw = JSON.parse(row.candles_json || "[]");
  } catch {
    raw = [];
  }

  return { row, candles: parseCandles(raw) };
}

function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const close = closes[closes.length - 1];
  const previousClose = closes.length >= 2 ? closes[closes.length - 2] : null;
  const volume = volumes[volumes.length - 1];

  const dma20 = sma(closes, 20);
  const dma50 = sma(closes, 50);
  const dma100 = sma(closes, 100);
  const dma200 = sma(closes, 200);

  const ema9 = lastEMA(closes, 9);
  const ema21 = lastEMA(closes, 21);
  const ema50 = lastEMA(closes, 50);

  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);

  const stochastic = calculateStochastic(highs, lows, closes, 14, 3);
  const bollinger = calculateBollinger(closes, 20, 2);

  const atr14 = calculateATR(highs, lows, closes, 14);
  const adx = calculateADX(highs, lows, closes, 14);

  const roc12 = closes.length >= 13 && closes[closes.length - 13] !== 0
    ? ((close / closes[closes.length - 13]) - 1) * 100
    : null;

  const volumeSMA20 = sma(volumes, 20);
  const obv = calculateOBV(closes, volumes);

  const atrPercent = atr14 !== null && close !== 0
    ? (atr14 / close) * 100
    : null;

  const bollingerWidth = bollinger.width;

  // Each component ranges from -1 (bearish) to +1 (bullish).
  // Missing data is excluded from the weighted score.
  const components = [];
  const details = [];

  function addSignal(name, value, weight, explanation) {
    if (value === null || !Number.isFinite(value)) return;

    components.push({ value, weight });
    details.push({ name, direction: value > 0 ? "bullish" : value < 0 ? "bearish" : "neutral", explanation });
  }

  const trendChecks = [];

  if (dma20 !== null) trendChecks.push(close > dma20 ? 1 : close < dma20 ? -1 : 0);
  if (dma50 !== null) trendChecks.push(close > dma50 ? 1 : close < dma50 ? -1 : 0);
  if (dma100 !== null) trendChecks.push(close > dma100 ? 1 : close < dma100 ? -1 : 0);
  if (dma200 !== null) trendChecks.push(close > dma200 ? 1 : close < dma200 ? -1 : 0);
  if (ema9 !== null && ema21 !== null) trendChecks.push(ema9 > ema21 ? 1 : ema9 < ema21 ? -1 : 0);
  if (ema21 !== null && ema50 !== null) trendChecks.push(ema21 > ema50 ? 1 : ema21 < ema50 ? -1 : 0);

  addSignal(
    "trend",
    trendChecks.length ? average(trendChecks) : null,
    30,
    "Based on price versus moving averages and EMA alignment."
  );

  const momentumChecks = [];

  if (rsi14 !== null) {
    momentumChecks.push(rsi14 >= 55 ? 1 : rsi14 <= 45 ? -1 : 0);
  }
  if (macd.histogram !== null) {
    momentumChecks.push(macd.histogram > 0 ? 1 : macd.histogram < 0 ? -1 : 0);
  }
  if (roc12 !== null) {
    momentumChecks.push(roc12 > 0 ? 1 : roc12 < 0 ? -1 : 0);
  }

  addSignal(
    "momentum",
    momentumChecks.length ? average(momentumChecks) : null,
    25,
    "Based on RSI, MACD histogram and 12-period rate of change."
  );

  let strengthValue = null;

  if (adx.adx !== null && adx.plusDI !== null && adx.minusDI !== null) {
    strengthValue = adx.adx < 15
      ? 0
      : adx.plusDI > adx.minusDI
        ? 1
        : adx.plusDI < adx.minusDI
          ? -1
          : 0;
  }

  addSignal(
    "trend_strength",
    strengthValue,
    15,
    "ADX measures trend strength; directional indicators determine direction."
  );

  const volumeChecks = [];

  if (volumeSMA20 !== null && volumeSMA20 > 0) {
    volumeChecks.push(volume > volumeSMA20 ? 1 : volume < volumeSMA20 ? -0.25 : 0);
  }

  if (closes.length > 20) {
    const previousObv = calculateOBV(
      closes.slice(0, -1),
      volumes.slice(0, -1)
    );
    volumeChecks.push(obv > previousObv ? 1 : obv < previousObv ? -1 : 0);
  }

  addSignal(
    "volume",
    volumeChecks.length ? average(volumeChecks) : null,
    15,
    "Based on volume relative to its 20-period average and OBV direction."
  );

  let volatilityValue = null;

  if (bollinger.upper !== null && bollinger.lower !== null) {
    volatilityValue = close > bollinger.upper
      ? 1
      : close < bollinger.lower
        ? -1
        : 0;
  }

  addSignal(
    "volatility_breakout",
    volatilityValue,
    15,
    "A close outside the Bollinger Bands indicates a potential breakout; confirm with other signals."
  );

  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const weightedScore = components.reduce(
    (sum, item) => sum + item.value * item.weight,
    0
  );

  const technicalScore = totalWeight > 0
    ? Math.round((50 + 50 * weightedScore / totalWeight) * 100) / 100
    : null;

  let technicalSignal = "Insufficient Data";

  if (technicalScore !== null) {
    if (technicalScore >= 70) technicalSignal = "Strong Bullish";
    else if (technicalScore >= 58) technicalSignal = "Bullish";
    else if (technicalScore <= 30) technicalSignal = "Strong Bearish";
    else if (technicalScore <= 42) technicalSignal = "Bearish";
    else technicalSignal = "Neutral";
  }

  const previousEMA9 = emaSeries(closes.slice(0, -1), 9).slice(-1)[0] ?? null;
  const previousEMA21 = emaSeries(closes.slice(0, -1), 21).slice(-1)[0] ?? null;

  if (previousEMA9 !== null && previousEMA21 !== null && ema9 !== null && ema21 !== null) {
    if (previousEMA9 <= previousEMA21 && ema9 > ema21) {
      details.push({ name: "ema_crossover", direction: "bullish", explanation: "EMA 9 crossed above EMA 21 on the latest stored candle." });
    } else if (previousEMA9 >= previousEMA21 && ema9 < ema21) {
      details.push({ name: "ema_crossover", direction: "bearish", explanation: "EMA 9 crossed below EMA 21 on the latest stored candle." });
    }
  }

  return {
    dma20, dma50, dma100, dma200,
    ema9, ema21, ema50,
    rsi14,
    macd: macd.macd,
    macd_signal: macd.signal,
    macd_histogram: macd.histogram,
    stochastic_k: stochastic.k,
    stochastic_d: stochastic.d,
    bollinger_middle: bollinger.middle,
    bollinger_upper: bollinger.upper,
    bollinger_lower: bollinger.lower,
    bollinger_width: bollingerWidth,
    atr14,
    atr_percent: atrPercent,
    adx14: adx.adx,
    plus_di14: adx.plusDI,
    minus_di14: adx.minusDI,
    roc12,
    volume_sma20: volumeSMA20,
    obv,
    technical_score: technicalScore,
    technical_signal: technicalSignal,
    signal_details: JSON.stringify(details)
  };
}

async function saveIndicators(env, metadata, candles, indicators) {
  const latestCandle = candles[candles.length - 1];
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO technical_indicator_data (
      instrument_key, symbol, company_name, isin, exchange,
      dma20, dma50, dma100, dma200,
      ema9, ema21, ema50,
      rsi14,
      macd, macd_signal, macd_histogram,
      stochastic_k, stochastic_d,
      bollinger_middle, bollinger_upper, bollinger_lower, bollinger_width,
      atr14, atr_percent,
      adx14, plus_di14, minus_di14,
      roc12, volume_sma20, obv,
      technical_score, technical_signal, signal_details,
      candle_count, latest_candle_time, data_status, updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, 'complete', ?
    )
    ON CONFLICT(instrument_key) DO UPDATE SET
      symbol = excluded.symbol,
      company_name = excluded.company_name,
      isin = excluded.isin,
      exchange = excluded.exchange,
      dma20 = excluded.dma20,
      dma50 = excluded.dma50,
      dma100 = excluded.dma100,
      dma200 = excluded.dma200,
      ema9 = excluded.ema9,
      ema21 = excluded.ema21,
      ema50 = excluded.ema50,
      rsi14 = excluded.rsi14,
      macd = excluded.macd,
      macd_signal = excluded.macd_signal,
      macd_histogram = excluded.macd_histogram,
      stochastic_k = excluded.stochastic_k,
      stochastic_d = excluded.stochastic_d,
      bollinger_middle = excluded.bollinger_middle,
      bollinger_upper = excluded.bollinger_upper,
      bollinger_lower = excluded.bollinger_lower,
      bollinger_width = excluded.bollinger_width,
      atr14 = excluded.atr14,
      atr_percent = excluded.atr_percent,
      adx14 = excluded.adx14,
      plus_di14 = excluded.plus_di14,
      minus_di14 = excluded.minus_di14,
      roc12 = excluded.roc12,
      volume_sma20 = excluded.volume_sma20,
      obv = excluded.obv,
      technical_score = excluded.technical_score,
      technical_signal = excluded.technical_signal,
      signal_details = excluded.signal_details,
      candle_count = excluded.candle_count,
      latest_candle_time = excluded.latest_candle_time,
      data_status = 'complete',
      updated_at = excluded.updated_at
  `).bind(
    metadata.instrument_key,
    metadata.symbol || null,
    metadata.company_name || null,
    metadata.isin || null,
    metadata.exchange || "NSE",

    indicators.dma20,
    indicators.dma50,
    indicators.dma100,
    indicators.dma200,

    indicators.ema9,
    indicators.ema21,
    indicators.ema50,

    indicators.rsi14,

    indicators.macd,
    indicators.macd_signal,
    indicators.macd_histogram,

    indicators.stochastic_k,
    indicators.stochastic_d,

    indicators.bollinger_middle,
    indicators.bollinger_upper,
    indicators.bollinger_lower,
    indicators.bollinger_width,

    indicators.atr14,
    indicators.atr_percent,

    indicators.adx14,
    indicators.plus_di14,
    indicators.minus_di14,

    indicators.roc12,
    indicators.volume_sma20,
    indicators.obv,

    indicators.technical_score,
    indicators.technical_signal,
    indicators.signal_details,

    candles.length,
    new Date(latestCandle.time * 1000).toISOString(),
    now
  ).run();
}

export async function onRequestPost(context) {
  try {
    const expectedSecret = context.env.TECHNICAL_REFRESH_SECRET;

    if (!expectedSecret) {
      return json({
        status: "error",
        message: "TECHNICAL_REFRESH_SECRET is not configured"
      }, 500);
    }

    const suppliedSecret = context.request.headers.get("X-Refresh-Secret");

    if (!suppliedSecret || suppliedSecret !== expectedSecret) {
      return json({ status: "error", message: "Unauthorized" }, 401);
    }

    let body = {};

    try {
      body = await context.request.json();
    } catch {
      body = {};
    }

    let stocks = Array.isArray(body.stocks) ? body.stocks : [];

    if (!stocks.length && body.instrument_key) {
      stocks = [{
        instrument_key: body.instrument_key,
        symbol: body.symbol || null,
        company_name: body.company_name || null,
        isin: body.isin || null,
        exchange: body.exchange || "NSE"
      }];
    }

    if (!stocks.length) {
      return json({ status: "error", message: "No stocks supplied" }, 400);
    }

    stocks = stocks.slice(0, MAX_STOCKS);
    const results = [];

    for (const stock of stocks) {
      const instrumentKey = String(stock.instrument_key || "").trim();

      if (!instrumentKey) {
        results.push({ status: "failed", message: "Missing instrument_key" });
        continue;
      }

      try {
        const stored = await getStoredCandles(context.env, instrumentKey);

        if (!stored) {
          results.push({
            instrument_key: instrumentKey,
            status: "failed",
            message: "No stored 1d candles found"
          });
          continue;
        }

        const candles = stored.candles;

        if (candles.length < MIN_CANDLES) {
          results.push({
            instrument_key: instrumentKey,
            symbol: stored.row.symbol || stock.symbol || null,
            status: "failed",
            message: `Not enough candles. Found ${candles.length}; need at least ${MIN_CANDLES}.`
          });
          continue;
        }

        const indicators = calculateIndicators(candles);

        const metadata = {
          instrument_key: instrumentKey,
          symbol: stored.row.symbol || stock.symbol || null,
          company_name: stored.row.company_name || stock.company_name || null,
          isin: stored.row.isin || stock.isin || null,
          exchange: stored.row.exchange || stock.exchange || "NSE"
        };

        await saveIndicators(context.env, metadata, candles, indicators);

        results.push({
          instrument_key: instrumentKey,
          symbol: metadata.symbol,
          status: "complete",
          candle_count: candles.length,
          technical_score: indicators.technical_score,
          technical_signal: indicators.technical_signal,
          indicators
        });

      } catch (error) {
        console.error("Indicator calculation failed:", instrumentKey, error);

        results.push({
          instrument_key: instrumentKey,
          status: "failed",
          message: error?.message || "Indicator calculation failed"
        });
      }
    }

    const failed = results.filter(item => item.status === "failed").length;

    return json({
      status: failed === results.length ? "error" : "success",
      source: "technical_chart_data",
      calculated_from: "stored_1d_candles",
      max_stocks: MAX_STOCKS,
      requested: stocks.length,
      completed: results.filter(item => item.status === "complete").length,
      failed,
      results,
      updated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error("Technical indicator refresh error:", error);

    return json({
      status: "error",
      message: error?.message || "Technical indicator refresh failed"
    }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return json({
    status: "error",
    message: "Method not allowed. Use POST."
  }, 405);
}
