export async function onRequestGet({ env }) {
  try {
    if (!env.KOTAK_ACCESS_TOKEN) {
      return Response.json({
        success: false,
        message: "KOTAK_ACCESS_TOKEN secret is missing"
      }, { status: 500 });
    }

    if (!env.KOTAK_BASE_URL) {
      return Response.json({
        success: false,
        message: "KOTAK_BASE_URL is missing. Complete Kotak TOTP login and MPIN validation first, then configure the returned baseUrl."
      }, { status: 400 });
    }

    const baseUrl = env.KOTAK_BASE_URL.replace(/\/+$/, "");
    const symbol = "nse_cm|RELIANCE-EQ";

    const response = await fetch(
      `${baseUrl}/script-details/1.0/quotes/neosymbol/${encodeURIComponent(symbol)}/all`,
      {
        method: "GET",
        headers: {
          "Authorization": env.KOTAK_ACCESS_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const result = await response.json();

    return Response.json({
      success: response.ok,
      provider: "Kotak Neo",
      stock: "RELIANCE",
      httpStatus: response.status,
      data: response.ok ? result : undefined,
      error: response.ok ? undefined : result
    }, { status: response.ok ? 200 : response.status });

  } catch (error) {
    return Response.json({
      success: false,
      message: "Kotak API connection failed",
      error: error.message
    }, { status: 500 });
  }
}
