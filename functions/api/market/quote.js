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

    const url = new URL(context.request.url);

    const instrumentKey =
      url.searchParams.get("instrument_key") ||
      "NSE_EQ|INE002A01018";

    const upstoxUrl =
      "https://api.upstox.com/v3/market-quote/quotes?instrument_key=" +
      encodeURIComponent(instrumentKey);

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
        message: error.message || "Unable to fetch market data"
      },
      { status: 500 }
    );
  }
}
