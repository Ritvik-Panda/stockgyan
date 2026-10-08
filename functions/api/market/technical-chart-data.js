// StockGyan — Technical Chart Data Read API
// Purpose:
// Read centrally stored chart candles from D1.
// IMPORTANT:
// This endpoint does NOT call Upstox.
// Users read StockGyan's stored market data.

const ALLOWED_INTERVALS = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1d"
]);

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=15",
      ...extraHeaders
    }
  });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;

    if (!db) {
      return json({
        status: "error",
        message: "D1 database binding DB is not configured"
      }, 500);
    }

    const url = new URL(context.request.url);

    const instrumentKey = (
      url.searchParams.get("instrument_key") || ""
    ).trim();

    const interval = (
      url.searchParams.get("interval") || ""
    ).trim().toLowerCase();

    if (!instrumentKey) {
      return json({
        status: "error",
        message: "instrument_key is required"
      }, 400);
    }

    if (!ALLOWED_INTERVALS.has(interval)) {
      return json({
        status: "error",
        message: "Invalid interval",
        allowed_intervals: Array.from(ALLOWED_INTERVALS)
      }, 400);
    }

    const result = await db.prepare(`
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
        AND interval = ?
      LIMIT 1
    `)
      .bind(instrumentKey, interval)
      .first();

    if (!result) {
      return json({
        status: "success",
        source: "d1",
        found: false,
        data: {
          candles: []
        },
        message: "No stored chart data available"
      });
    }

    let candles = [];

    try {
      candles = JSON.parse(result.candles_json || "[]");
    } catch (error) {
      return json({
        status: "error",
        message: "Stored candle data is invalid",
        instrument_key: instrumentKey,
        interval
      }, 500);
    }

    if (!Array.isArray(candles)) {
      candles = [];
    }

    return json({
      status: "success",
      source: "d1",
      found: true,

      instrument_key: result.instrument_key,
      symbol: result.symbol,
      company_name: result.company_name,
      isin: result.isin,
      exchange: result.exchange,

      interval: result.interval,

      candle_count: result.candle_count || candles.length,
      latest_candle_time: result.latest_candle_time,
      data_status: result.data_status,
      updated_at: result.updated_at,

      data: {
        candles
      }
    });

  } catch (error) {
    console.error(
      "technical-chart-data error:",
      error?.message || error
    );

    return json({
      status: "error",
      message: "Unable to read technical chart data"
    }, 500);
  }
}
