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

    if (!quoteResponse.ok) {
      return Response.json(quoteData, {
        status: quoteResponse.status,
        headers: {
          "Cache-Control": "no-store"
        }
      });
    }

    const liveData = quoteData?.data || {};

    // Convert a timestamp into the current India date.
    function istDate(value) {
      if (value === undefined || value === null || value === "") {
        return "";
      }

      const n = Number(value);
      const date = Number.isFinite(n)
        ? new Date(n < 100000000000 ? n * 1000 : n)
        : new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "";
      }

      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
    }

    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    // The quote API can still return Friday's last quote on a Saturday,
    // Sunday or exchange holiday. In that situation the current last price
    // and previous close can be identical, so calculate the last-session
    // move from historical daily candles instead.
    const liveRows = Object.values(liveData);

    const hasTodayQuote = liveRows.some(item => {
      return istDate(item?.last_trade_time) === todayIst ||
             istDate(item?.timestamp) === todayIst ||
             istDate(item?.ohlc?.ts) === todayIst;
    });

    const dayName = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short"
    }).format(new Date());

    const weekend = dayName === "Sat" || dayName === "Sun";

    const useHistoricalSession = weekend || !hasTodayQuote;

    if (!useHistoricalSession) {
      return Response.json(quoteData, {
        status: quoteResponse.status,
        headers: {
          "Cache-Control": "no-store"
        }
      });
    }

    // Closed-market fallback:
    // Historical V3 daily candles provide the latest trading session and the
    // preceding trading session. This is the correct source for session-over-
    // session gain/loss when the exchange is closed.
    const fromDateObj = new Date();
    fromDateObj.setUTCDate(fromDateObj.getUTCDate() - 7);

    const fromDate = fromDateObj.toISOString().slice(0, 10);
    const toDate = todayIst;

    const historicalResults = await Promise.all(
      keys.map(async key => {
        try {
          const historicalUrl =
            "https://api.upstox.com/v3/historical-candle/" +
            `${encodeURIComponent(key)}/days/1/${toDate}/${fromDate}`;

          const response = await fetch(historicalUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`
            }
          });

          if (!response.ok) {
            return { key, data: null };
          }

          const data = await response.json();
          return { key, data };
        } catch {
          return { key, data: null };
        }
      })
    );

    const result = {
      status: "success",
      data: {}
    };

    for (const item of historicalResults) {
      const candles = item.data?.data?.candles || [];

      if (!candles.length) {
        continue;
      }

      const sorted = [...candles].sort(
        (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
      );

      const latest = sorted[sorted.length - 1];
      const previous = sorted.length >= 2
        ? sorted[sorted.length - 2]
        : null;

      const latestClose = Number(latest[4]);
      const previousClose = previous
        ? Number(previous[4])
        : latestClose;

      if (!Number.isFinite(latestClose)) {
        continue;
      }

      const change = Number.isFinite(previousClose)
        ? latestClose - previousClose
        : 0;

      const symbol = item.key.includes("|")
        ? item.key.split("|")[1]
        : item.key;

      result.data[item.key.replace("|", ":")] = {
        last_price: latestClose,
        change,
        net_change: change,
        prev_close: previousClose,
        prev_close_price: previousClose,
        ohlc: {
          open: Number(latest[1]),
          high: Number(latest[2]),
          low: Number(latest[3]),
          close: latestClose,
          volume: Number(latest[5] || 0),
          ts: latest[0]
        },
        volume: Number(latest[5] || 0),
        last_trade_time: latest[0],
        instrument_token: item.key,
        symbol,
        _source: "historical-fallback"
      };
    }

    // If historical data was unavailable for some instrument, retain the
    // live quote so the rest of the terminal can still display it.
    for (const [returnedKey, quote] of Object.entries(liveData)) {
      if (!result.data[returnedKey]) {
        result.data[returnedKey] = quote;
      }
    }

    return Response.json(result, {
      status: 200,
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
