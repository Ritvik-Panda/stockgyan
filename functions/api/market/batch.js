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

    const upstoxUrl =
      "https://api.upstox.com/v3/market-quote/quotes?instrument_key=" +
      keys.map(encodeURIComponent).join(",");

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
          "Unable to fetch batch market data"
      },
      { status: 500 }
    );
  }
}
