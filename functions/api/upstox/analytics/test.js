
export async function onRequest(context) {
  const token = context.env.UPSTOX_ANALYTICS_TOKEN2;

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 secret not found"
    }, { status: 500 });
  }

  try {
    const response = await fetch(
      "https://api.upstox.com/v2/user/profile",
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return Response.json({
        success: false,
        status: response.status,
        message: result.message || "Upstox API authentication failed"
      }, { status: response.status });
    }

    return Response.json({
      success: true,
      message: "Second Upstox account connected successfully",
      user_name: result.data?.user_name || "Connected",
      user_id: result.data?.user_id || "Verified"
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Connection error"
    }, { status: 500 });
  }
}
