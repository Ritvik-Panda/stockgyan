export async function onRequestGet(context) {
  try {
    const response = await fetch(
      "https://stockgyan.in/assets/nse-universe.json",
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
            "Unable to load NSE universe",
          upstream_status: response.status
        },
        { status: 502 }
      );
    }

    const source = await response.json();

    if (
      !source ||
      !Array.isArray(source.data)
    ) {
      return Response.json(
        {
          status: "error",
          message:
            "Invalid NSE universe data"
        },
        { status: 502 }
      );
    }

    const stocks = source.data
      .filter(item =>
        item &&
        item.instrument_key &&
        item.isin
      )
      .map(item => ({
        symbol:
          item.symbol ||
          item.trading_symbol ||
          "",

        name:
          item.name ||
          item.company_name ||
          item.symbol ||
          item.trading_symbol ||
          "",

        isin:
          String(item.isin)
            .trim()
            .toUpperCase(),

        instrument_key:
          item.instrument_key
      }));

    return Response.json(
      {
        status: "success",
        exchange: "NSE",
        count: stocks.length,
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
          "Unable to load NSE Health Screener universe"
      },
      { status: 500 }
    );
  }
}
