
 // StockGyan — Advanced Technical Indicator Data API
 // Reads all calculated indicators from D1.
 // No direct Upstox calls.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

const INDICATOR_FIELDS = `
  instrument_key,
  symbol,
  company_name,
  isin,
  exchange,

  dma20,
  dma50,
  dma100,
  dma200,

  ema9,
  ema21,
  ema50,

  rsi14,

  macd,
  macd_signal,
  macd_histogram,

  stochastic_k,
  stochastic_d,

  bollinger_middle,
  bollinger_upper,
  bollinger_lower,
  bollinger_width,

  atr14,
  atr_percent,

  adx14,
  plus_di14,
  minus_di14,

  roc12,
  volume_sma20,
  obv,

  technical_score,
  technical_signal,
  signal_details,

  candle_count,
  latest_candle_time,
  data_status,
  updated_at
`;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);

    const instrumentKey =
      url.searchParams.get("instrument_key");

    const symbol =
      url.searchParams.get("symbol");

    if (!instrumentKey && !symbol) {
      return json({
        status: "error",
        message: "Provide instrument_key or symbol"
      }, 400);
    }

    const sql = `
      SELECT ${INDICATOR_FIELDS}
      FROM technical_indicator_data
      WHERE ${instrumentKey ? "instrument_key = ?" : "UPPER(symbol) = ?"}
      LIMIT 1
    `;

    const lookupValue = instrumentKey || symbol.trim().toUpperCase();

    const row = await context.env.DB.prepare(sql)
      .bind(lookupValue)
      .first();

    if (!row) {
      return json({
        status: "success",
        source: "d1",
        found: false,
        data: null
      });
    }

    return json({
      status: "success",
      source: "d1",
      found: true,
      data: row
    });

  } catch (error) {
    console.error("Technical indicator data API error:", error);

    return json({
      status: "error",
      message:
        error?.message ||
        "Unable to read technical indicator data"
    }, 500);
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") {
    return onRequestGet(context);
  }

  return json({
    status: "error",
    message: "Method not allowed"
  }, 405);
}
