export async function onRequestGet(context) {
  try {
    /*
     * StockGyan NSE Universe
     *
     * Purpose:
     * Return the NSE equity universe for internal
     * StockGyan backend processes.
     *
     * Upstox → StockGyan → cached NSE universe
     *
     * IMPORTANT:
     * - Does not call Upstox from the browser.
     * - Uses Cloudflare cache.
     * - Only NSE_EQ / EQ stocks are returned.
     */

    const cache = caches.default;

    const cacheKey = new Request(
      "https://stockgyan.in/api/market/universe"
    );

    /*
     * -----------------------------------------------------
     * CHECK CACHE FIRST
     * -----------------------------------------------------
     */

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }

    /*
     * -----------------------------------------------------
     * UPSTOX NSE INSTRUMENT FILE
     * -----------------------------------------------------
     */

    const url =
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument file returned HTTP " +
            response.status
        },
        {
          status: 502
        }
      );
    }

    /*
     * -----------------------------------------------------
     * READ RESPONSE
     *
     * IMPORTANT:
     * Cloudflare fetch handles HTTP content encoding.
     * Do NOT manually use DecompressionStream here.
     * -----------------------------------------------------
     */

    let text;

    try {
      text = await response.text();
    } catch (error) {
      return Response.json(
        {
          status: "error",
          message:
            "Unable to read Upstox NSE instrument file",
          detail:
            error?.message || "Unknown response error"
        },
        {
          status: 502
        }
      );
    }

    /*
     * -----------------------------------------------------
     * PARSE JSON
     * -----------------------------------------------------
     */

    let instruments;

    try {
      instruments = JSON.parse(text);
    } catch (error) {
      return Response.json(
        {
          status: "error",
          message:
            "Unable to parse NSE instrument data",
          content_type:
            response.headers.get("content-type") || "",
          content_encoding:
            response.headers.get("content-encoding") || "",
          sample:
            text.substring(0, 200)
        },
        {
          status: 500
        }
      );
    }

    /*
     * -----------------------------------------------------
     * VALIDATE INSTRUMENT ARRAY
     * -----------------------------------------------------
     */

    if (!Array.isArray(instruments)) {
      return Response.json(
        {
          status: "error",
          message:
            "Upstox NSE instrument data is not an array"
        },
        {
          status: 500
        }
      );
    }

    /*
     * -----------------------------------------------------
     * NSE EQUITY STOCKS ONLY
     * -----------------------------------------------------
     */

    const stocks = instruments
      .filter(function(item) {
        return (
          item &&
          item.segment === "NSE_EQ" &&
          item.instrument_type === "EQ"
        );
      })
      .map(function(item) {
        return {
          symbol:
            item.trading_symbol || null,

          name:
            item.name || null,

          isin:
            item.isin || null,

          instrument_key:
            item.instrument_key || null
        };
      })
      .filter(function(item) {
        return (
          item.instrument_key &&
          item.symbol
        );
      });

    /*
     * -----------------------------------------------------
     * FINAL RESPONSE
     * -----------------------------------------------------
     */

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

    /*
     * Store successful universe in Cloudflare cache
     * for 6 hours.
     */

    await cache.put(
      cacheKey,
      result.clone()
    );

    return result;

  } catch (error) {

    console.error(
      "StockGyan NSE universe error:",
      error
    );

    return Response.json(
      {
        status: "error",
        message:
          error?.message ||
          "Unable to load NSE stock universe"
      },
      {
        status: 500
      }
    );
  }
}
