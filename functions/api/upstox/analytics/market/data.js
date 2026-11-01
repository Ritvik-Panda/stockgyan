
export async function onRequest(context) {
  const token = context.env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 secret not configured"
    }, { status: 500 });
  }

  try {
    // STEP 1: Download official Upstox instrument master.
    const masterResponse = await fetch(
      "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz"
    );

    if (!masterResponse.ok) {
      throw new Error(
        `Instrument master download failed: HTTP ${masterResponse.status}`
      );
    }

    const instruments = await masterResponse.json();

    if (!Array.isArray(instruments)) {
      throw new Error("Invalid instrument master response");
    }

    // STEP 2: Select eligible NSE and BSE equity instruments.
    const stocks = instruments.filter(stock =>
      ["NSE_EQ", "BSE_EQ"].includes(stock.segment) &&
      stock.instrument_type === "EQ" &&
      stock.instrument_key &&
      stock.trading_symbol
    );

    if (!stocks.length) {
      throw new Error("No NSE/BSE equity instruments found");
    }

    // STEP 3: Fetch quotes in batches of 500.
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

      const result = await response.json();

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

    // STEP 4: Combine instrument information and quotes.
    const data = stocks.map(stock => {
      const quoteKey =
        `${stock.segment}:${stock.trading_symbol}`;

      const quote = quotes[quoteKey] || {};

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

        open: quote.ohlc?.open ?? null,
        high: quote.ohlc?.high ?? null,
        low: quote.ohlc?.low ?? null,
        previous_close: quote.ohlc?.close ?? null,

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
