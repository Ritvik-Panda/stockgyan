
export async function onRequest(context) {
  const token = context.env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 not configured"
    }, { status: 500 });
  }

  try {
    // 1. Download Upstox's official NSE instrument master.
    const masterResponse = await fetch(
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
    );

    if (!masterResponse.ok) {
      throw new Error("Unable to download NSE instrument master");
    }

    const instruments = await masterResponse.json();

    if (!Array.isArray(instruments)) {
      throw new Error("Invalid instrument master format");
    }

    // 2. Select all NSE cash-equity instruments.
    const stocks = instruments.filter(stock =>
      stock.segment === "NSE_EQ" &&
      stock.instrument_type !== "INDEX" &&
      stock.instrument_key &&
      stock.trading_symbol
    );

    if (!stocks.length) {
      throw new Error("No NSE equity instruments found");
    }

    // 3. Fetch full quotes in batches of 500.
    const batchSize = 500;
    const quotes = {};
    const errors = [];

    for (let i = 0; i < stocks.length; i += batchSize) {
      const batch = stocks.slice(i, i + batchSize);

      const params = new URLSearchParams({
        instrument_key: batch.map(s => s.instrument_key).join(",")
      });

      const response = await fetch(
        `https://api.upstox.com/v3/market-quote/quotes?${params}`,
        {
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

    // 4. Combine instrument master and market quotes.
    const data = stocks.map(stock => {
      const quoteKey = `NSE_EQ:${stock.trading_symbol}`;
      const quote = quotes[quoteKey] || {};

      return {
        company: stock.name,
        symbol: stock.trading_symbol,
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

    return Response.json({
      success: true,
      provider: "Upstox Analytics Account 2",
      exchange: "NSE",
      total_instruments: stocks.length,
      quoted_instruments: Object.keys(quotes).length,
      failed_batches: errors.length,
      errors,
      data
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: error.message || "Unable to load NSE stocks"
    }, { status: 500 });
  }
}
