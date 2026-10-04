export async function onRequestGet(context) {
  try {
    const cache = caches.default;

    const cacheKey = new Request(
      "https://stockgyan.in/api/health-screener/universe"
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }

    const url =
      "https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz";

    const response = await fetch(url);

    if (!response.ok) {
      return Response.json(
        {
          status: "error",
          message:
            "Upstox Complete instrument file returned HTTP " +
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
            "Unable to parse Upstox Complete instrument data",
          content_type: contentType,
          content_encoding: encoding,
          sample: text.substring(0, 200)
        },
        { status: 500 }
      );
    }

    const companies = new Map();

    for (const item of instruments) {
      if (!item) {
        continue;
      }

      const segment =
        String(item.segment || "").toUpperCase();

      const instrumentType =
        String(item.instrument_type || "").toUpperCase();

      const isin =
        String(item.isin || "")
          .trim()
          .toUpperCase();

      if (!isin) {
        continue;
      }

      if (
        instrumentType !== "EQ" ||
        (
          segment !== "NSE_EQ" &&
          segment !== "BSE_EQ"
        )
      ) {
        continue;
      }

      const instrumentKey =
        String(item.instrument_key || "").trim();

      if (!instrumentKey) {
        continue;
      }

      let company = companies.get(isin);

      if (!company) {
        company = {
          isin,
          name:
            item.name ||
            item.short_name ||
            item.trading_symbol ||
            isin,

          short_name:
            item.short_name ||
            item.trading_symbol ||
            item.name ||
            isin,

          nse_instrument_key: "",
          bse_instrument_key: "",

          nse_symbol: "",
          bse_symbol: "",

          exchange: "",

          instrument_key: "",
          symbol: ""
        };
      }

      if (segment === "NSE_EQ") {
        company.nse_instrument_key =
          instrumentKey;

        company.nse_symbol =
          item.trading_symbol || "";
      }

      if (segment === "BSE_EQ") {
        company.bse_instrument_key =
          instrumentKey;

        company.bse_symbol =
          item.trading_symbol || "";
      }

      const exchanges = [];

      if (company.nse_instrument_key) {
        exchanges.push("NSE");
      }

      if (company.bse_instrument_key) {
        exchanges.push("BSE");
      }

      company.exchange =
        exchanges.join(" / ");

      /*
       * Use NSE as the primary instrument when
       * the company is listed on both exchanges.
       */
      company.instrument_key =
        company.nse_instrument_key ||
        company.bse_instrument_key;

      company.symbol =
        company.nse_symbol ||
        company.bse_symbol ||
        "";

      companies.set(isin, company);
    }

    const stocks =
      Array.from(companies.values())
        .filter(item => item.instrument_key)
        .sort((a, b) =>
          String(a.name).localeCompare(
            String(b.name)
          )
        );

    const nseCount =
      stocks.filter(item =>
        item.nse_instrument_key
      ).length;

    const bseCount =
      stocks.filter(item =>
        item.bse_instrument_key
      ).length;

    const result = Response.json(
      {
        status: "success",

        count: stocks.length,

        exchanges: {
          NSE: nseCount,
          BSE: bseCount
        },

        data: stocks
      },
      {
        status: 200,

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
          "Unable to load Health Screener universe"
      },
      { status: 500 }
    );
  }
}
