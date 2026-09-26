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

    const keysParam =
      requestUrl.searchParams.get("instrument_keys");

    if (!keysParam) {
      return Response.json(
        {
          status: "error",
          message: "instrument_keys is required"
        },
        { status: 400 }
      );
    }

    const keys = keysParam
      .split(",")
      .map(key => key.trim())
      .filter(Boolean);

    if (!keys.length) {
      return Response.json(
        {
          status: "error",
          message: "No instrument keys supplied"
        },
        { status: 400 }
      );
    }

    if (keys.length > 500) {
      return Response.json(
        {
          status: "error",
          message: "Maximum 500 instruments allowed"
        },
        { status: 400 }
      );
    }

    const encodedKeys = keys.map(encodeURIComponent).join(",");

    // First try the full live quote endpoint.
    const quoteUrl =
      "https://api.upstox.com/v3/market-quote/quotes?instrument_key=" +
      encodedKeys;

    const quoteResponse = await fetch(quoteUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const quoteData = await quoteResponse.json();

    const result = {
      status: quoteData?.status || "success",
      data: {
        ...(quoteData?.data || {})
      }
    };

    // On weekends/holidays the full quote endpoint may return no rows.
    // Fill missing instruments from V3 daily OHLC, which provides the
    // current/most recent session and previous trading session OHLC.
    const missingKeys = keys.filter(key => !result.data[key.replace("|", ":")]);

    if (missingKeys.length) {
      const ohlcUrl =
        "https://api.upstox.com/v3/market-quote/ohlc?instrument_key=" +
        missingKeys.map(encodeURIComponent).join(",") +
        "&interval=1d";

      const ohlcResponse = await fetch(ohlcUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        }
      });

      const ohlcData = await ohlcResponse.json();

      for (const [symbolKey, item] of Object.entries(ohlcData?.data || {})) {
        const live = item?.live_ohlc || {};
        const previous = item?.prev_ohlc || {};

        const lastPrice =
          Number.isFinite(Number(live.close))
            ? Number(live.close)
            : Number(previous.close);

        const prevClose =
          Number.isFinite(Number(previous.close))
            ? Number(previous.close)
            : lastPrice;

        const change = lastPrice - prevClose;

        result.data[symbolKey] = {
          last_price: lastPrice,
          change,
          prev_close: prevClose,
          prev_close_price: prevClose,
          ohlc: {
            open: Number.isFinite(Number(live.open))
              ? Number(live.open)
              : Number(previous.open),
            high: Number.isFinite(Number(live.high))
              ? Number(live.high)
              : Number(previous.high),
            low: Number.isFinite(Number(live.low))
              ? Number(live.low)
              : Number(previous.low),
            close: lastPrice
          },
          volume: Number(live.volume ?? previous.volume ?? 0),
          last_trade_time:
            live.ts || previous.ts || null,
          instrument_token: item?.instrument_token || null,
          symbol: item?.symbol || symbolKey.split(":").pop(),
          _source: "ohlc-fallback"
        };
      }
    }

    return Response.json(result, {
      status: quoteResponse.ok ? 200 : quoteResponse.status,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch batch market data"
      },
      { status: 500 }
    );
  }
}
