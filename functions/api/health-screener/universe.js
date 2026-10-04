export async function onRequestGet(context) {
  try {
    /*
     * Health Screener uses the same proven NSE universe
     * already used by StockGyan's existing market system.
     *
     * We deliberately do not download another Upstox
     * instrument file here.
     */

    const response = await fetch(
      "https://stockgyan.in/api/market/universe",
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      return Response.json(
        {
          status: "error",
          message:
            "Unable to load existing NSE stock universe",
          upstream_status: response.status
        },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (
      !data ||
      data.status !== "success" ||
      !Array.isArray(data.data)
    ) {
      return Response.json(
        {
          status: "error",
          message:
            "Existing NSE universe returned invalid data"
        },
        { status: 502 }
      );
    }

    /*
     * Keep only the fields required by Health Screener.
     * ISIN is the identity used to retrieve fundamentals.
     */
    const stocks = data.data
      .filter(item =>
        item &&
        item.isin &&
        item.instrument_key
      )
      .map(item => ({
        symbol: item.symbol || "",
        name: item.name || item.symbol || "",
        isin: String(item.isin)
          .trim()
          .toUpperCase(),
        instrument_key:
          item.instrument_key
      }));

    return Response.json(
      {
        status: "success",
        count: stocks.length,
        exchange: "NSE",
        data: stocks
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "public, max-age=21600"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to load Health Screener NSE universe"
      },
      { status: 500 }
    );
  }
}
