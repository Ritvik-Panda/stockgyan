// StockGyan — Central Technical Chart Data Engine
// Upstox → StockGyan Backend → D1
//
// Purpose:
// - Fetch controlled market candle data from Upstox
// - Store it centrally in D1
// - Users will later read D1 instead of calling Upstox directly
//
// Protected by TECHNICAL_REFRESH_SECRET
// Maximum 5 stocks per request
//
// IMPORTANT:
// This endpoint is intentionally separate from the Health/Fundamental engine.

const ALLOWED_INTERVALS = ["1m", "5m", "15m", "30m", "1d"];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function normaliseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseCandle(candle) {
  if (!Array.isArray(candle) || candle.length < 6) {
    return null;
  }

  return {
    time: candle[0],
    open: normaliseNumber(candle[1]),
    high: normaliseNumber(candle[2]),
    low: normaliseNumber(candle[3]),
    close: normaliseNumber(candle[4]),
    volume: normaliseNumber(candle[5])
  };
}

function cleanCandles(candles) {
  if (!Array.isArray(candles)) return [];

  const output = [];
  const seen = new Set();

  for (const candle of candles) {
    const normalized = normaliseCandle(candle);

    if (!normalized) continue;
    if (!normalized.time) continue;

    if (
      normalized.open === null ||
      normalized.high === null ||
      normalized.low === null ||
      normalized.close === null
    ) {
      continue;
    }

    const key = String(normalized.time);

    if (seen.has(key)) continue;

    seen.add(key);
    output.push(normalized);
  }

  output.sort((a, b) => {
    return String(a.time).localeCompare(String(b.time));
  });

  return output;
}

async function fetchWithRetry(url, token, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        }
      });

      const text = await response.text();

      let data = null;

      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (response.ok && data) {
        return {
          ok: true,
          status: response.status,
          data
        };
      }

      lastError = {
        status: response.status,
        body: text.slice(0, 500)
      };

      // Retry rate-limit and server errors.
      if (
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504
      ) {
        if (attempt < attempts) {
          await sleep(700 * attempt);
          continue;
        }
      }

      return {
        ok: false,
        ...lastError
      };

    } catch (error) {
      lastError = {
        status: 0,
        body: error?.message || "Network error"
      };

      if (attempt < attempts) {
        await sleep(700 * attempt);
      }
    }
  }

  return {
    ok: false,
    ...(lastError || {
      status: 0,
      body: "Unknown error"
    })
  };
}

function buildUpstoxUrl(instrumentKey, interval) {
  const encodedKey = encodeURIComponent(instrumentKey);

  if (interval === "1m") {
    return `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/1`;
  }

  if (interval === "5m") {
    return `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/5`;
  }

  if (interval === "15m") {
    return `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/15`;
  }

  if (interval === "30m") {
    return `https://api.upstox.com/v3/historical-candle/intraday/${encodedKey}/minutes/30`;
  }

  if (interval === "1d") {
    const today = new Date();

    const toDate = today.toISOString().slice(0, 10);

    const fromDate = new Date(
      today.getTime() - 366 * 24 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);

    return `https://api.upstox.com/v3/historical-candle/${encodedKey}/days/1/${toDate}/${fromDate}`;
  }

  return null;
}

async function fetchCandles(instrumentKey, interval, token) {
  const url = buildUpstoxUrl(instrumentKey, interval);

  if (!url) {
    return {
      ok: false,
      error: `Unsupported interval: ${interval}`
    };
  }

  const result = await fetchWithRetry(url, token);

  if (!result.ok) {
    return {
      ok: false,
      error: `Upstream request failed`,
      upstreamStatus: result.status,
      upstreamBody: result.body
    };
  }

  const candles =
    result.data?.data?.candles ??
    result.data?.candles ??
    [];

  const cleaned = cleanCandles(candles);

  if (!cleaned.length) {
    return {
      ok: false,
      error: "No candles returned",
      upstreamStatus: result.status
    };
  }

  return {
    ok: true,
    candles: cleaned
  };
}

async function storeChartData(
  db,
  stock,
  interval,
  candles
) {
  const now = new Date().toISOString();

  const latest =
    candles.length > 0
      ? candles[candles.length - 1].time
      : null;

  await db
    .prepare(`
      INSERT INTO technical_chart_data (
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

      ON CONFLICT(instrument_key, interval)
      DO UPDATE SET
        symbol = excluded.symbol,
        company_name = excluded.company_name,
        isin = excluded.isin,
        exchange = excluded.exchange,
        candles_json = excluded.candles_json,
        candle_count = excluded.candle_count,
        latest_candle_time = excluded.latest_candle_time,
        data_status = excluded.data_status,
        updated_at = excluded.updated_at
    `)
    .bind(
      stock.instrument_key,
      stock.symbol || null,
      stock.company_name || null,
      stock.isin || null,
      stock.exchange || "NSE",
      interval,
      JSON.stringify(candles),
      candles.length,
      latest,
      "complete",
      now
    )
    .run();
}

export async function onRequestPost(context) {
  try {
    const env = context.env;

    /*
     * Separate technical secret.
     */
    const configuredSecret =
      env.TECHNICAL_REFRESH_SECRET;

    if (!configuredSecret) {
      return json(
        {
          status: "error",
          message: "TECHNICAL_REFRESH_SECRET is not configured"
        },
        500
      );
    }

    const suppliedSecret =
      context.request.headers.get("X-Technical-Refresh-Secret");

    if (
      !suppliedSecret ||
      suppliedSecret !== configuredSecret
    ) {
      return json(
        {
          status: "error",
          message: "Unauthorized"
        },
        401
      );
    }

    if (!env.DB) {
      return json(
        {
          status: "error",
          message: "D1 binding DB is not configured"
        },
        500
      );
    }

    const token = env.UPSTOX_ANALYTICS_TOKEN;

    if (!token) {
      return json(
        {
          status: "error",
          message: "UPSTOX_ANALYTICS_TOKEN is not configured"
        },
        500
      );
    }

    let body;

    try {
      body = await context.request.json();
    } catch {
      return json(
        {
          status: "error",
          message: "Invalid JSON body"
        },
        400
      );
    }

    const stocks = Array.isArray(body?.stocks)
      ? body.stocks
      : [];

    if (!stocks.length) {
      return json(
        {
          status: "error",
          message: "stocks array is required"
        },
        400
      );
    }

    if (stocks.length > 5) {
      return json(
        {
          status: "error",
          message: "Maximum 5 stocks per request"
        },
        400
      );
    }

    const requestedIntervals =
      Array.isArray(body?.intervals) &&
      body.intervals.length
        ? body.intervals
        : ["1d"];

    const intervals = [
      ...new Set(
        requestedIntervals.filter(interval =>
          ALLOWED_INTERVALS.includes(interval)
        )
      )
    ];

    if (!intervals.length) {
      return json(
        {
          status: "error",
          message: "No valid intervals supplied",
          allowedIntervals: ALLOWED_INTERVALS
        },
        400
      );
    }

    const results = [];

    /*
     * Process sequentially.
     *
     * This is deliberate.
     * We do NOT fire dozens of Upstox requests simultaneously.
     */
    for (const stock of stocks) {
      const stockResult = {
        instrument_key: stock.instrument_key,
        symbol: stock.symbol || null,
        intervals: []
      };

      if (!stock.instrument_key) {
        stockResult.error = "instrument_key is required";
        results.push(stockResult);
        continue;
      }

      for (const interval of intervals) {
        try {
          const result = await fetchCandles(
            stock.instrument_key,
            interval,
            token
          );

          if (!result.ok) {
            stockResult.intervals.push({
              interval,
              status: "failed",
              error: result.error,
              upstreamStatus: result.upstreamStatus || null
            });

            continue;
          }

          await storeChartData(
            env.DB,
            stock,
            interval,
            result.candles
          );

          stockResult.intervals.push({
            interval,
            status: "complete",
            candleCount: result.candles.length,
            latestCandleTime:
              result.candles[result.candles.length - 1].time
          });

          /*
           * Small delay prevents unnecessary bursts.
           */
          await sleep(250);

        } catch (error) {
          stockResult.intervals.push({
            interval,
            status: "failed",
            error:
              error?.message ||
              "Unexpected processing error"
          });
        }
      }

      results.push(stockResult);
    }

    const refreshed = results.reduce(
      (count, stock) =>
        count +
        stock.intervals.filter(
          item => item.status === "complete"
        ).length,
      0
    );

    const failed = results.reduce(
      (count, stock) =>
        count +
        stock.intervals.filter(
          item => item.status === "failed"
        ).length,
      0
    );

    return json({
      status: "success",
      engine: "technical-chart-data",
      stocksProcessed: stocks.length,
      intervals,
      refreshed,
      failed,
      results
    });

  } catch (error) {
    return json(
      {
        status: "error",
        message:
          error?.message ||
          "Unexpected server error"
      },
      500
    );
  }
}
