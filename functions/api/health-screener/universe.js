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

    async function loadInstrumentFile(url) {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Upstox instrument file returned HTTP ${response.status}`
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
        const stream =
          response.body.pipeThrough(
            new DecompressionStream("gzip")
          );

        text = await new Response(stream).text();
      } else {
        text = await response.text();
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(
          "Unable to parse Upstox instrument data"
        );
      }
    }

    const nseUrl =
      "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";

    const bseUrl =
      "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz";

    const [nseInstruments, bseInstruments] =
      await Promise.all([
        loadInstrumentFile(nseUrl),
        loadInstrumentFile(bseUrl)
      ]);

    const companies = new Map();

    function addInstrument(item, exchange) {
      if (!item) {
        return;
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
        return;
      }

      if (
        segment !== `${exchange}_EQ` ||
        instrumentType !== "EQ"
      ) {
        return;
      }

      const instrumentKey =
        String(item.instrument_key || "").trim();

      if (!instrumentKey) {
        return;
      }

      const existing = companies.get(isin);

      const record =
        existing ||
        {
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

          exchange: ""
        };

      if (exchange === "NSE") {
        record.nse_instrument_key =
          instrumentKey;

        record.nse_symbol =
          item.trading_symbol || "";
      }

      if (exchange === "BSE") {
        record.bse_instrument_key =
          instrumentKey;

        record.bse_symbol =
          item.trading_symbol || "";
      }

      const exchanges = [];

      if (record.nse_instrument_key) {
        exchanges.push("NSE");
      }

      if (record.bse_instrument_key) {
        exchanges.push("BSE");
      }

      record.exchange =
        exchanges.join(" / ");

      /*
       * Prefer NSE as the primary listing when
       * the company is available on both exchanges.
       */
      record.instrument_key =
        record.nse_instrument_key ||
        record.bse_instrument_key;

      record.symbol =
        record.nse_symbol ||
        record.bse_symbol ||
        "";

      companies.set(isin, record);
    }

    for (const item of nseInstruments) {
      addInstrument(item, "NSE");
    }

    for (const item of bseInstruments) {
      addInstrument(item, "BSE");
    }

    const stocks = Array.from(companies.values())
      .filter(item => item.instrument_key)
      .sort((a, b) =>
        String(a.name).localeCompare(
          String(b.name)
        )
      );

    const result = Response.json(
      {
        status: "success",

        count: stocks.length,

        exchanges: {
          NSE: stocks.filter(item =>
            item.nse_instrument_key
          ).length,

          BSE: stocks.filter(item =>
            item.bse_instrument_key
          ).length
        },

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
          "Unable to load NSE and BSE Health Screener universe"
      },
      { status: 500 }
    );
  }
}
