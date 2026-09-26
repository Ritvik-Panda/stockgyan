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
      requestUrl.searchParams.get("instrument_key");

    const interval =
      requestUrl.searchParams.get("interval") || "1d";

    if (!instrumentKey) {
      return Response.json(
        {
          status: "error",
          message: "instrument_key is required"
        },
        { status: 400 }
      );
    }

    const allowedIntervals = [
      "1d",
      "1m",
      "30m"
    ];

    if (!allowedIntervals.includes(interval)) {
      return Response.json(
        {
          status: "error",
          message: "Invalid interval"
        },
        { status: 400 }
      );
    }

    const encodedKey = encodeURIComponent(instrumentKey);

    const upstoxUrl =
      `https://api.upstox.com/v3/historical-candle/${encodedKey}/${interval}`;

    const response = await fetch(upstoxUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();

    return Response.json(data, {
      status: response.status,
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
          "Unable to fetch historical market data"
      },
      { status: 500 }
    );
  }
}
