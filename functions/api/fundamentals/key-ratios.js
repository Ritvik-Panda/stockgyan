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

    const isin = (url.searchParams.get("isin") || "")
      .trim()
      .toUpperCase();

    if (!isin || !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
      return Response.json(
        {
          status: "error",
          message: "Valid ISIN is required"
        },
        { status: 400 }
      );
    }

    const upstoxUrl =
      "https://api.upstox.com/v2/fundamentals/" +
      encodeURIComponent(isin) +
      "/key-ratios";

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
          "Unable to fetch fundamental ratios"
      },
      { status: 500 }
    );
  }
}
