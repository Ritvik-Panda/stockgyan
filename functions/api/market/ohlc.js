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

    let unit;
    let value;
    let daysBack;

    if (interval === "1d") {
      unit = "days";
      value = "1";
      daysBack = 365;
    } else if (interval === "1m") {
      unit = "minutes";
      value = "1";
      daysBack = 30;
    } else if (interval === "30m") {
      unit = "minutes";
      value = "30";
      daysBack = 90;
    } else {
      return Response.json(
        {
          status: "error",
          message: "Invalid interval"
        },
        { status: 400 }
      );
    }

    const today = new Date();

    const toDate =
      today.toISOString().slice(0, 10);

    const from = new Date(today);

    from.setDate(
      from.getDate() - daysBack
    );

    const fromDate =
      from.toISOString().slice(0, 10);

    const encodedKey =
      encodeURIComponent(instrumentKey);

    const upstoxUrl =
      `https://api.upstox.com/v3/historical-candle/` +
      `${encodedKey}/${unit}/${value}/${toDate}/${fromDate}`;

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
