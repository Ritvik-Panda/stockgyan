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

    const isin =
      (url.searchParams.get("isin") || "")
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

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    };

    const baseUrl =
      "https://api.upstox.com/v2/fundamentals/" +
      encodeURIComponent(isin);

    const keyRatiosUrl =
      baseUrl + "/key-ratios";

    const incomeStatementUrl =
      baseUrl +
      "/income-statement?type=consolidated&time_period=yearly";

    const balanceSheetUrl =
      baseUrl +
      "/balance-sheet?type=consolidated";

    const [
      keyRatiosResponse,
      incomeStatementResponse,
      balanceSheetResponse
    ] = await Promise.all([
      fetch(keyRatiosUrl, {
        method: "GET",
        headers
      }),

      fetch(incomeStatementUrl, {
        method: "GET",
        headers
      }),

      fetch(balanceSheetUrl, {
        method: "GET",
        headers
      })
    ]);

    const [
      keyRatios,
      incomeStatement,
      balanceSheet
    ] = await Promise.all([
      keyRatiosResponse.json(),
      incomeStatementResponse.json(),
      balanceSheetResponse.json()
    ]);

    if (
      !keyRatiosResponse.ok ||
      !incomeStatementResponse.ok ||
      !balanceSheetResponse.ok
    ) {
      return Response.json(
        {
          status: "error",
          message: "Unable to fetch complete company fundamentals",
          key_ratios_status: keyRatiosResponse.status,
          income_statement_status:
            incomeStatementResponse.status,
          balance_sheet_status:
            balanceSheetResponse.status
        },
        { status: 502 }
      );
    }

    return Response.json(
      {
        status: "success",
        data: {
          key_ratios: keyRatios,
          income_statement: incomeStatement,
          balance_sheet: balanceSheet
        }
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=3600"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch company fundamentals"
      },
      { status: 500 }
    );
  }
}
