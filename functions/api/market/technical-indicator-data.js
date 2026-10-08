// StockGyan — Central Technical Indicator Data API
// Reads calculated indicators from D1.
// No Upstox calls.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);

    const instrumentKey =
      url.searchParams.get("instrument_key");

    const symbol =
      url.searchParams.get("symbol");

    let row = null;

    if (instrumentKey) {
      row = await context.env.DB.prepare(`
        SELECT
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

        FROM technical_indicator_data
        WHERE instrument_key = ?
        LIMIT 1
      `)
        .bind(instrumentKey)
        .first();

    } else if (symbol) {
      row = await context.env.DB.prepare(`
        SELECT
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

        FROM technical_indicator_data
        WHERE symbol = ?
        LIMIT 1
      `)
        .bind(symbol.toUpperCase())
        .first();

    } else {
      return json({
        status: "error",
        message:
          "Provide instrument_key or symbol"
      }, 400);
    }

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
    console.error(
      "Technical indicator data API error:",
      error
    );

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
