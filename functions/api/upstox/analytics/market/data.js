
async function downloadInstrumentFile(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/gzip, application/json, */*",
      "User-Agent": "Mozilla/5.0 StockGyan/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check whether the response is GZIP compressed.
  const isGzip = bytes.length >= 2 &&
    bytes[0] === 0x1f &&
    bytes[1] === 0x8b;

  let jsonText;

  if (isGzip) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("GZIP decompression is not supported in this runtime");
    }

    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));

    jsonText = await new Response(stream).text();
  } else {
    // Some servers automatically decompress the response.
    jsonText = new TextDecoder().decode(buffer);
  }

  const parsed = JSON.parse(jsonText);

  if (!Array.isArray(parsed)) {
    throw new Error("Instrument file did not contain a JSON array");
  }

  return parsed;
}

async function getInstrumentMaster() {
  const base =
    "https://assets.upstox.com/market-quote/instruments/exchange/";

  // Try the complete master first.
  try {
    return await downloadInstrumentFile(base + "complete.json.gz");
  } catch (completeError) {
    // If complete fails, try separate NSE and BSE masters.
    const results = await Promise.allSettled([
      downloadInstrumentFile(base + "NSE.json.gz"),
      downloadInstrumentFile(base + "BSE.json.gz")
    ]);

    const combined = results
      .filter(result => result.status === "fulfilled")
      .flatMap(result => result.value);

    if (combined.length > 0) {
      return combined;
    }

    const errors = results
      .map((result, index) => {
        const exchange = index === 0 ? "NSE" : "BSE";
        return `${exchange}: ${
          result.status === "rejected"
            ? result.reason.message
            : "Unknown error"
        }`;
      })
      .join("; ");

    throw new Error(
      `Instrument master download failed. Complete: ${completeError.message}. ${errors}`
    );
  }
}

export async function onRequest(context) {
  const token = context.env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 secret not configured"
    }, { status: 500 });
  }

  try {
    // STEP 1: Download and decompress the official instrument master.
    const instruments = await getInstrumentMaster();

    // STEP 2: Select NSE and BSE equity instruments.
    const stocks = instruments.filter(stock =>
      ["NSE_EQ", "BSE_EQ"].includes(stock.segment) &&
      ["EQ", "BE"].includes(stock.instrument_type) &&
      stock.instrument_key &&
      stock.trading_symbol
    );

    if (!stocks.length) {
      throw new Error("No NSE/BSE equity instruments found");
    }

    // STEP 3: Fetch full market quotes in batches of 500.
    const batchSize = 500;
    const quotes = {};
    const errors = [];

    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);

      const params = new URLSearchParams();
      params.set(
        "instrument_key",
        batch.map(stock => stock.instrument_key).join(",")
      );

      const response = await fetch(
        `https://api.upstox.com/v3/market-quote/quotes?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Authorization": `Bearer ${token}`
          }
        }
      );

      let result;

      try {
        result = await response.json();
      } catch {
        result = {};
      }

      if (!response.ok) {
        errors.push({
          batch: Math.floor(i / batchSize) + 1,
          status: response.status,
          message: result.message || "Quote request failed"
        });

        continue;
      }

      Object.assign(quotes, result.data || {});
    }

    // STEP 4: Combine stock information with market quotes.
    const data = stocks.map(stock => {
      const quoteKey = `${stock.segment}:${stock.trading_symbol}`;
      const quote = quotes[quoteKey] || {};
      const ohlc = quote.ohlc || {};

      return {
        company: stock.name || stock.trading_symbol,
        symbol: stock.trading_symbol,
        exchange: stock.segment === "NSE_EQ" ? "NSE" : "BSE",
        segment: stock.segment,
        instrument_key: stock.instrument_key,
        instrument_type: stock.instrument_type,
        isin: stock.isin || null,

        cmp: quote.last_price ?? null,
        volume: quote.volume ?? null,
        average_price: quote.average_price ?? null,

        open: ohlc.open ?? null,
        high: ohlc.high ?? null,
        low: ohlc.low ?? null,
        previous_close: quote.prev_close_price ?? ohlc.close ?? null,

        year_high: quote.year_high ?? null,
        year_low: quote.year_low ?? null,

        market_data_available: quote.last_price != null
      };
    });

    // STEP 5: Exchange-wise summary.
    const nseStocks = data.filter(stock => stock.exchange === "NSE");
    const bseStocks = data.filter(stock => stock.exchange === "BSE");

    return Response.json({
      success: true,
      provider: "Upstox Analytics Account 2",
      exchange: "NSE + BSE",

      summary: {
        total_instruments: data.length,
        nse_instruments: nseStocks.length,
        bse_instruments: bseStocks.length,
        quoted_instruments: data.filter(
          stock => stock.market_data_available
        ).length,
        unquoted_instruments: data.filter(
          stock => !stock.market_data_available
        ).length,
        failed_batches: errors.length
      },

      errors,
      data
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: error.message || "Unable to fetch market data"
    }, { status: 500 });
  }
}
