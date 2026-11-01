
export async function onRequest(context) {
  const token = context.env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "Analytics token secret not found"
    }, { status: 500 });
  }

  try {
    const url =
      "https://api.upstox.com/v2/market-quote/ltp?instrument_key=NSE_EQ%7CINE002A01018";

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${token}`
      }
    });

    const result = await response.json();

    if (!response.ok) {
      return Response.json({
        success: false,
        status: response.status,
        message: result.message || "Market data request failed",
        details: result.errors || null
      }, { status: response.status });
    }

    return Response.json({
      success: true,
      message: "Second Upstox Analytics connection working",
      data: result.data
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Connection error"
    }, { status: 500 });
  }
}
