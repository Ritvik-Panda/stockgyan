export async function onRequestGet({ env }) {
  const token = env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 secret is not available."
    }, { status: 500 });
  }

  try {
    const response = await fetch(
      "https://api.upstox.com/v2/fundamentals/INE002A01018/key-ratios",
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const result = await response.json();

    return Response.json({
      success: response.ok && result.status === "success",
      http_status: response.status,
      provider: "Upstox Fundamentals",
      test_company: "Reliance Industries",
      data: result
    }, { status: 200 });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Unable to connect to Upstox Fundamentals API.",
      error: error.message
    }, { status: 500 });
  }
}
