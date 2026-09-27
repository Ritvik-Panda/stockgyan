export async function onRequestGet(context) {
  try {
    const token = context.env.UPSTOX_ANALYTICS_TOKEN;

    if (!token) {
      return Response.json(
        {
          status: "error",
          message: "Upstox token is not configured"
        },
        { status: 500 }
      );
    }

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
          message:
            "Upstox NSE instrument file returned HTTP " +
            response.status
        },
        { status: 502 }
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    const encoding =
      response.headers.get("content-encoding") || "";

    let text;

    /*
     * Cloudflare may automatically decompress
     * the gzip response depending on the response headers.
     */

    if (
      encoding.includes("gzip") ||
      contentType.includes("gzip")
    ) {
      try {
        const stream =
          response.body.pipeThrough(
            new DecompressionStream("gzip")
          );

        text = await new Response(stream).text();

      } catch (error) {
        return Response.json(
          {
            status: "error",
            message:
              "Gzip decompression failed: " +
              error.message
          },
          { status: 500 }
        );
      }
    } else {
      text = await response.text();
    }

    let instruments;

    try {
      instruments = JSON.parse(text);
    } catch (error) {
      return Response.json(
        {
          status: "error",
          message:
            "Unable to parse NSE instrument data",
          content_type: contentType,
          content_encoding: encoding,
          sample: text.substring(0, 200)
        },
        { status: 500 }
      );
    }

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
          "Cache-Control":
            "public, max-age=21600"
        }
      }
    );

    await cache.put(
      cacheKey,
      result.clone()
    );

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
