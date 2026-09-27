export async function onRequestGet(context) {
  try {
    const cache = caches.default;

    const cacheKey = new Request(
      "https://stockgyan.in/api/market/universe"
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }

    const url =
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

    const response = await fetch(url);

    if (!response.ok) {
      return Response.json(
        {
          status: "error",
          message: "Unable to download NSE instrument file"
        },
        { status: 502 }
      );
    }

    let text;

    try {
      const decompressedStream =
        response.body.pipeThrough(
          new DecompressionStream("gzip")
        );

      text = await new Response(
        decompressedStream
      ).text();

    } catch (e) {
      return Response.json(
        {
          status: "error",
          message:
            "Unable to decompress NSE instrument file: " +
            e.message
        },
        { status: 500 }
      );
    }

    const instruments = JSON.parse(text);

    const stocks = instruments
      .filter(item =>
        item.segment === "NSE_EQ" &&
        item.instrument_type === "EQ"
      )
      .map(item => ({
        symbol: item.trading_symbol,
        name: item.name,
        isin: item.isin,
        instrument_key: item.instrument_key
      }))
      .filter(item => item.instrument_key);

    const result = Response.json(
      {
        status: "success",
        count: stocks.length,
        data: stocks
      },
      {
        headers: {
          "Cache-Control": "public, max-age=21600"
        }
      }
    );

    await cache.put(cacheKey, result.clone());

    return result;

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to load NSE stock universe"
      },
      { status: 500 }
    );
  }
}
