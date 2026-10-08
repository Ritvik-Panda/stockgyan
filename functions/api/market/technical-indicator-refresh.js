// StockGyan — Central Technical Indicator Engine
// Upstox → Stored candles → Indicator calculation → D1
//
// Endpoint:
// POST /api/market/technical-indicator-refresh
//
// Security:
// X-Refresh-Secret: TECHNICAL_REFRESH_SECRET
//
// Purpose:
// Calculate technical indicators from centrally stored 1D candles.
// No direct Upstox calls from the browser.

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

  if (values.length < period) {
    return result;
  }

  const first = average(values.slice(0, period));

  if (first === null) {
    return result;
  }

  result[period - 1] = first;

  const multiplier = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    const previous = result[i - 1];

    if (previous === null || !Number.isFinite(previous)) {
      continue;
    }

    result[i] =
      ((values[i] - previous) * multiplier) +
      previous;
  }

  return result;
}

function calculateDMA(closes, period) {
  return sma(closes, period);
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain =
      ((averageGain * (period - 1)) + gain) / period;

    averageLoss =
      ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) {
    return 100;
  }

  const relativeStrength =
    averageGain / averageLoss;

  return 100 - (100 / (1 + relativeStrength));
}

function calculateMACD(closes) {
  const fast = emaSeries(closes, 12);
  const slow = emaSeries(closes, 26);

  const macdSeries = [];

  for (let i = 0; i < closes.length; i++) {
    if (
      fast[i] !== null &&
      slow[i] !== null
    ) {
      macdSeries.push(fast[i] - slow[i]);
    }
  }

  if (!macdSeries.length) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const signalSeries =
    emaSeries(macdSeries, 9);

  const macd =
    macdSeries[macdSeries.length - 1];

  const signal =
    signalSeries[signalSeries.length - 1];

  const histogram =
    signal !== null
      ? macd - signal
      : null;

  return {
    macd,
    signal,
    histogram
  };
}

function calculateStochastic(
  highs,
  lows,
  closes,
  period = 14,
  smooth = 3
) {
  if (closes.length < period) {
    return {
      k: null,
      d: null
    };
  }

  const kSeries = [];

  for (
    let i = period - 1;
    i < closes.length;
    i++
  ) {
    const start = i - period + 1;

    const highestHigh =
      Math.max(...highs.slice(start, i + 1));

    const lowestLow =
      Math.min(...lows.slice(start, i + 1));

    const range =
      highestHigh - lowestLow;

    if (range === 0) {
      kSeries.push(0);
    } else {
      const k =
        ((closes[i] - lowestLow) / range) * 100;

      kSeries.push(k);
    }
  }

  if (!kSeries.length) {
    return {
      k: null,
      d: null
    };
  }

  const k =
    kSeries[kSeries.length - 1];

  const d =
    kSeries.length >= smooth
      ? average(kSeries.slice(-smooth))
      : null;

  return {
    k,
    d
  };
}

function calculateBollinger(
  closes,
  period = 20,
  multiplier = 2
) {
  if (closes.length < period) {
    return {
      middle: null,
      upper: null,
      lower: null
    };
  }

  const values =
    closes.slice(-period);

  const middle =
    average(values);

  if (middle === null) {
    return {
      middle: null,
      upper: null,
      lower: null
    };
  }

  const variance =
    values.reduce(
      (sum, value) =>
        sum + Math.pow(value - middle, 2),
      0
    ) / period;

  const standardDeviation =
    Math.sqrt(variance);

  return {
    middle,
    upper:
      middle + (multiplier * standardDeviation),
    lower:
      middle - (multiplier * standardDeviation)
  };
}

function calculateATR(
  highs,
  lows,
  closes,
  period = 14
) {
  if (closes.length <= period) {
    return null;
  }

  const trueRanges = [];

  for (let i = 1; i < closes.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const previousClose = closes[i - 1];

    const trueRange = Math.max(
      high - low,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose)
    );

    trueRanges.push(trueRange);
  }

  if (trueRanges.length < period) {
    return null;
  }

  let atr =
    average(trueRanges.slice(0, period));

  for (
    let i = period;
    i < trueRanges.length;
    i++
  ) {
    atr =
      ((atr * (period - 1)) +
        trueRanges[i]) /
      period;
  }

  return atr;
}

function parseCandles(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : [];

  return arr
    .map((c) => {
      const rawTime =
        Array.isArray(c)
          ? c?.[0]
          : c?.time;

      const ms =
        typeof rawTime === "number"
          ? (
              rawTime > 1e12
                ? rawTime
                : rawTime * 1000
            )
          : new Date(rawTime).getTime();

      const open =
        Array.isArray(c)
          ? c?.[1]
          : c?.open;

      const high =
        Array.isArray(c)
          ? c?.[2]
          : c?.high;

      const low =
        Array.isArray(c)
          ? c?.[3]
          : c?.low;

      const close =
        Array.isArray(c)
          ? c?.[4]
          : c?.close;

      const volume =
        Array.isArray(c)
          ? c?.[5]
          : c?.volume;

      return {
        time: Math.floor(ms / 1000),
        open: num(open),
        high: num(high),
        low: num(low),
        close: num(close),
        volume: num(volume) || 0
      };
    })
    .filter((c) =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close)
    )
    .sort((a, b) => a.time - b.time);
}

async function getStoredCandles(
  env,
  instrumentKey
) {
  const row = await env.DB.prepare(`
    SELECT
      instrument_key,
      symbol,
      company_name,
      isin,
      exchange,
      interval,
      candles_json,
      candle_count,
      latest_candle_time,
      data_status,
      updated_at
    FROM technical_chart_data
    WHERE instrument_key = ?
      AND interval = '1d'
    LIMIT 1
  `)
    .bind(instrumentKey)
    .first();

  if (!row) {
    return null;
  }

  let rawCandles = [];

  try {
    rawCandles =
      JSON.parse(row.candles_json || "[]");
  } catch {
    rawCandles = [];
  }

  const candles =
    parseCandles(rawCandles);

  return {
    row,
    candles
  };
}

function calculateIndicators(candles) {
  const closes =
    candles.map((c) => c.close);

  const highs =
    candles.map((c) => c.high);

  const lows =
    candles.map((c) => c.low);

  const dma20 =
    calculateDMA(closes, 20);

  const dma50 =
    calculateDMA(closes, 50);

  const dma100 =
    calculateDMA(closes, 100);

  const dma200 =
    calculateDMA(closes, 200);

  const rsi14 =
    calculateRSI(closes, 14);

  const macd =
    calculateMACD(closes);

  const stochastic =
    calculateStochastic(
      highs,
      lows,
      closes,
      14,
      3
    );

  const bollinger =
    calculateBollinger(
      closes,
      20,
      2
    );

  const atr14 =
    calculateATR(
      highs,
      lows,
      closes,
      14
    );

  return {
    dma20,
    dma50,
    dma100,
    dma200,

    rsi14,

    macd: macd.macd,
    macd_signal: macd.signal,
    macd_histogram: macd.histogram,

    stochastic_k: stochastic.k,
    stochastic_d: stochastic.d,

    bollinger_middle: bollinger.middle,
    bollinger_upper: bollinger.upper,
    bollinger_lower: bollinger.lower,

    atr14
  };
}

async function saveIndicators(
  env,
  metadata,
  candles,
  indicators
) {
  const now =
    new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO technical_indicator_data (
      instrument_key,
      symbol,
      company_name,
      isin,
      exchange,

      dma20,
      dma50,
      dma100,
      dma200,

      rsi14,

      macd,
      macd_signal,
      macd_histogram,

      stochastic_k,
      stochastic_d,

      bollinger_middle,
      bollinger_upper,
      bollinger_lower,

      atr14,

      candle_count,
      latest_candle_time,

      data_status,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?,
      ?, ?,
      'complete',
      ?
    )
    ON CONFLICT(instrument_key)
    DO UPDATE SET
      symbol = excluded.symbol,
      company_name = excluded.company_name,
      isin = excluded.isin,
      exchange = excluded.exchange,

      dma20 = excluded.dma20,
      dma50 = excluded.dma50,
      dma100 = excluded.dma100,
      dma200 = excluded.dma200,

      rsi14 = excluded.rsi14,

      macd = excluded.macd,
      macd_signal = excluded.macd_signal,
      macd_histogram = excluded.macd_histogram,

      stochastic_k = excluded.stochastic_k,
      stochastic_d = excluded.stochastic_d,

      bollinger_middle = excluded.bollinger_middle,
      bollinger_upper = excluded.bollinger_upper,
      bollinger_lower = excluded.bollinger_lower,

      atr14 = excluded.atr14,

      candle_count = excluded.candle_count,
      latest_candle_time = excluded.latest_candle_time,

      data_status = 'complete',
      updated_at = excluded.updated_at
  `)
    .bind(
      metadata.instrument_key,
      metadata.symbol || null,
      metadata.company_name || null,
      metadata.isin || null,
      metadata.exchange || "NSE",

      indicators.dma20,
      indicators.dma50,
      indicators.dma100,
      indicators.dma200,

      indicators.rsi14,

      indicators.macd,
      indicators.macd_signal,
      indicators.macd_histogram,

      indicators.stochastic_k,
      indicators.stochastic_d,

      indicators.bollinger_middle,
      indicators.bollinger_upper,
      indicators.bollinger_lower,

      indicators.atr14,

      candles.length,
      new Date(
        candles[candles.length - 1].time * 1000
      ).toISOString(),

      now
    )
    .run();
}

export async function onRequestPost(context) {
  try {
    const expectedSecret =
      context.env.TECHNICAL_REFRESH_SECRET;

    if (!expectedSecret) {
      return json(
        {
          status: "error",
          message:
            "TECHNICAL_REFRESH_SECRET is not configured"
        },
        500
      );
    }

    const suppliedSecret =
      context.request.headers.get(
        "X-Refresh-Secret"
      );

    if (
      !suppliedSecret ||
      suppliedSecret !== expectedSecret
    ) {
      return json(
        {
          status: "error",
          message: "Unauthorized"
        },
        401
      );
    }

    let body = {};

    try {
      body =
        await context.request.json();
    } catch {
      body = {};
    }

    let stocks =
      Array.isArray(body.stocks)
        ? body.stocks
        : [];

    if (!stocks.length && body.instrument_key) {
      stocks = [
        {
          instrument_key:
            body.instrument_key,
          symbol:
            body.symbol || null,
          company_name:
            body.company_name || null,
          isin:
            body.isin || null,
          exchange:
            body.exchange || "NSE"
        }
      ];
    }

    if (!stocks.length) {
      return json(
        {
          status: "error",
          message:
            "No stocks supplied"
        },
        400
      );
    }

    stocks =
      stocks.slice(0, MAX_STOCKS);

    const results = [];

    for (const stock of stocks) {
      const instrumentKey =
        String(
          stock.instrument_key || ""
        ).trim();

      if (!instrumentKey) {
        results.push({
          status: "failed",
          message:
            "Missing instrument_key"
        });

        continue;
      }

      try {
        const stored =
          await getStoredCandles(
            context.env,
            instrumentKey
          );

        if (!stored) {
          results.push({
            instrument_key:
              instrumentKey,
            status: "failed",
            message:
              "No stored 1d candles found"
          });

          continue;
        }

        const candles =
          stored.candles;

        if (
          candles.length <
          MIN_CANDLES
        ) {
          results.push({
            instrument_key:
              instrumentKey,
            symbol:
              stored.row.symbol ||
              stock.symbol ||
              null,
            status: "failed",
            message:
              `Not enough candles. Found ${candles.length}, need at least ${MIN_CANDLES}.`
          });

          continue;
        }

        const indicators =
          calculateIndicators(
            candles
          );

        const metadata = {
          instrument_key:
            instrumentKey,

          symbol:
            stored.row.symbol ||
            stock.symbol ||
            null,

          company_name:
            stored.row.company_name ||
            stock.company_name ||
            null,

          isin:
            stored.row.isin ||
            stock.isin ||
            null,

          exchange:
            stored.row.exchange ||
            stock.exchange ||
            "NSE"
        };

        await saveIndicators(
          context.env,
          metadata,
          candles,
          indicators
        );

        results.push({
          instrument_key:
            instrumentKey,

          symbol:
            metadata.symbol,

          status:
            "complete",

          candle_count:
            candles.length,

          indicators
        });

      } catch (error) {
        console.error(
          "Indicator calculation failed:",
          instrumentKey,
          error
        );

        results.push({
          instrument_key:
            instrumentKey,

          status:
            "failed",

          message:
            error?.message ||
            "Indicator calculation failed"
        });
      }
    }

    return json({
      status: "success",
      source: "technical_chart_data",
      calculated_from: "stored_1d_candles",
      max_stocks: MAX_STOCKS,
      requested: stocks.length,
      results,
      updated_at:
        new Date().toISOString()
    });

  } catch (error) {
    console.error(
      "Technical indicator refresh error:",
      error
    );

    return json(
      {
        status: "error",
        message:
          error?.message ||
          "Technical indicator refresh failed"
      },
      500
    );
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }

  return json(
    {
      status: "error",
      message:
        "Method not allowed. Use POST."
    },
    405
  );
}
