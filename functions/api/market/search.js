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

    const query = requestUrl.searchParams.get("query")?.trim();

    if (!query) {
      return Response.json(
        {
          status: "error",
          message: "Search query is required"
        },
        { status: 400 }
      );
    }

    const params = new URLSearchParams();

    params.set("query", query);
    params.set("exchanges", "NSE,BSE");
    params.set("segments", "EQ,INDEX");
    params.set("page_number", "1");
    params.set("records", "20");

    const upstoxUrl =
      "https://api.upstox.com/v2/instruments/search?" +
      params.toString();

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
          "Unable to search instruments"
      },
      { status: 500 }
    );
  }
}
