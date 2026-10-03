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

    const isin = url.searchParams.get("isin");

    if (!isin) {
      return Response.json(
        {
          status: "error",
          message: "ISIN is required"
        },
        { status: 400 }
      );
    }

    const type = url.searchParams.get("type") || "consolidated";
    const timePeriod = url.searchParams.get("time_period") || "yearly";
    const fs = url.searchParams.get("fs") || "false";

    const upstoxUrl =
      "https://api.upstox.com/v2/fundamentals/" +
      encodeURIComponent(isin) +
      "/balance-sheet?type=" +
      encodeURIComponent(type) +
      "&time_period=" +
      encodeURIComponent(timePeriod) +
      "&fs=" +
      encodeURIComponent(fs);

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
        "Cache-Control": "public, max-age=3600"
      }
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch balance sheet"
      },
      { status: 500 }
    );
  }
}
