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

    /*
      StockGyan 1D chart:
      1 Min
      5 Min
      15 Min
      30 Min
    */

    const intradayIntervals = ["1m", "5m", "15m", "30m"];

    let upstoxUrl;

    if (intradayIntervals.includes(interval)) {

      const minutes = interval.replace("m", "");

      upstoxUrl =
        "https://api.upstox.com/v3/historical-candle/intraday/" +
        `${encodeURIComponent(instrumentKey)}/minutes/${minutes}`;

    } else if (interval === "1d") {

      /*
        Daily candles for:
        1W / 1M / 3M / 1Y / ALL
      */

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

    } else {

      return Response.json(
        {
          status: "error",
          message:
            "Invalid interval. Use 1m, 5m, 15m, 30m or 1d."
        },
        { status: 400 }
      );
    }

    const response = await fetch(upstoxUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    return Response.json(
      data,
      {
        status: response.status,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch chart data"
      },
      { status: 500 }
    );

  }
}
