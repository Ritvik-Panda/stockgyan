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

    const requestUrl = new URL(context.request.url);

    const instrumentKey =
      requestUrl.searchParams.get("instrument_key")?.trim();

    const interval =
      requestUrl.searchParams.get("interval")?.trim() || "1d";

    if (!instrumentKey) {
      return Response.json(
        {
          status: "error",
          message: "instrument_key is required"
        },
        { status: 400 }
      );
    }

    const intradayIntervals = [
      "1m",
      "5m",
      "15m",
      "30m"
    ];

    let upstoxUrl;
    let cacheSeconds;

    /*
      --------------------------------------------------
      INTRADAY
      --------------------------------------------------
    */

    if (intradayIntervals.includes(interval)) {

      const minutes = interval.replace("m", "");

      upstoxUrl =
        "https://api.upstox.com/v3/historical-candle/intraday/" +
        `${encodeURIComponent(instrumentKey)}/minutes/${minutes}`;

      /*
        Intraday data changes frequently.
        Cache for 30 seconds.
      */
      cacheSeconds = 30;

    }

    /*
      --------------------------------------------------
      DAILY
      --------------------------------------------------
    */

    else if (interval === "1d") {

      const today = new Date();

      const toDate =
        today.toISOString().slice(0, 10);

      const from = new Date(today);

      from.setFullYear(
        from.getFullYear() - 10
      );

      const fromDate =
        from.toISOString().slice(0, 10);

      upstoxUrl =
        "https://api.upstox.com/v3/historical-candle/" +
        `${encodeURIComponent(instrumentKey)}/days/1/${toDate}/${fromDate}`;

      /*
        Daily historical data does not need to be
        downloaded repeatedly.

        Cache for 6 hours.
      */
      cacheSeconds = 21600;

    }

    else {

      return Response.json(
        {
          status: "error",
          message:
            "Invalid interval. Use 1m, 5m, 15m, 30m or 1d."
        },
        { status: 400 }
      );
    }


    /*
      --------------------------------------------------
      SHARED CLOUDFLARE CACHE
      --------------------------------------------------

      Create a stable cache key.

      For daily data we include today's date so that
      a new trading day automatically gets a new cache.
    */

    const cache = caches.default;

    const cacheDate =
      interval === "1d"
        ? new Date().toISOString().slice(0, 10)
        : "intraday";

    const cacheKeyUrl =
      new URL(
        "https://stockgyan-cache.local/api/market/ohlc"
      );

    cacheKeyUrl.searchParams.set(
      "instrument_key",
      instrumentKey
    );

    cacheKeyUrl.searchParams.set(
      "interval",
      interval
    );

    cacheKeyUrl.searchParams.set(
      "cache_date",
      cacheDate
    );

    const cacheKey = new Request(
      cacheKeyUrl.toString(),
      {
        method: "GET"
      }
    );


    /*
      --------------------------------------------------
      CHECK CACHE
      --------------------------------------------------
    */

    try {

      const cachedResponse =
        await cache.match(cacheKey);

      if (cachedResponse) {

        const headers =
          new Headers(cachedResponse.headers);

        headers.set(
          "X-StockGyan-Cache",
          "HIT"
        );

        return new Response(
          cachedResponse.body,
          {
            status: cachedResponse.status,
            headers
          }
        );
      }

    } catch (cacheError) {

      /*
        Cache failure must never break
        the historical-data API.
      */

      console.error(
        "Cache read error:",
        cacheError
      );
    }


    /*
      --------------------------------------------------
      FETCH FROM UPSTOX
      --------------------------------------------------
    */

    const response = await fetch(upstoxUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });


    /*
      --------------------------------------------------
      HANDLE NON-JSON UPSTOX RESPONSE
      --------------------------------------------------
    */

    const contentType =
      response.headers.get("content-type") || "";

    if (
      !contentType
        .toLowerCase()
        .includes("application/json")
    ) {

      const text =
        await response.text();

      console.error(
        "Upstox returned non-JSON response:",
        response.status,
        text.slice(0, 300)
      );

      return Response.json(
        {
          status: "error",
          message:
            response.status === 429 ||
            response.status === 1015
              ? "Historical data is temporarily rate limited. Please try again shortly."
              : `Historical data service returned HTTP ${response.status}.`,
          upstream_status:
            response.status
        },
        {
          status:
            response.status === 429 ||
            response.status === 1015
              ? 429
              : 502,

          headers: {
            "Cache-Control":
              "no-store",
            "X-StockGyan-Cache":
              "MISS"
          }
        }
      );
    }


    /*
      --------------------------------------------------
      PARSE JSON
      --------------------------------------------------
    */

    const data =
      await response.json();


    /*
      --------------------------------------------------
      CACHE ONLY SUCCESSFUL DATA
      --------------------------------------------------
    */

    if (response.ok) {

      try {

        const cacheHeaders =
          new Headers();

        cacheHeaders.set(
          "Content-Type",
          "application/json"
        );

        cacheHeaders.set(
          "Cache-Control",
          `public, max-age=${cacheSeconds}`
        );

        cacheHeaders.set(
          "X-StockGyan-Cache",
          "MISS"
        );

        const cacheResponse =
          new Response(
            JSON.stringify(data),
            {
              status: 200,
              headers: cacheHeaders
            }
          );

        /*
          Store a clone in the shared
          Cloudflare cache.
        */

        await cache.put(
          cacheKey,
          cacheResponse.clone()
        );

      } catch (cacheError) {

        /*
          If caching fails, the actual
          Upstox response still succeeds.
        */

        console.error(
          "Cache write error:",
          cacheError
        );
      }
    }


    /*
      --------------------------------------------------
      RETURN RESPONSE
      --------------------------------------------------
    */

    return Response.json(
      data,
      {
        status: response.status,
        headers: {
          "Cache-Control":
            response.ok
              ? `public, max-age=${cacheSeconds}`
              : "no-store",

          "X-StockGyan-Cache":
            "MISS"
        }
      }
    );

  } catch (error) {

    console.error(
      "OHLC endpoint error:",
      error
    );

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch chart data"
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store"
        }
      }
    );
  }
}
