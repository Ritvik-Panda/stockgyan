export async function onRequestPost(context) {
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

    const body = await context.request.json();

    const isins = Array.isArray(body.isins)
      ? body.isins
          .map(isin =>
            String(isin || "")
              .trim()
              .toUpperCase()
          )
          .filter(isin =>
            /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)
          )
      : [];

    if (!isins.length) {
      return Response.json(
        {
          status: "error",
          message: "At least one valid ISIN is required"
        },
        { status: 400 }
      );
    }

    if (isins.length > 20) {
      return Response.json(
        {
          status: "error",
          message: "Maximum 20 ISINs per request"
        },
        { status: 400 }
      );
    }

    const uniqueIsins = [...new Set(isins)];

    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`
    };

    async function fetchFundamentals(isin) {
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

      try {
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

        return {
          isin,
          success:
            keyRatiosResponse.ok &&
            incomeStatementResponse.ok &&
            balanceSheetResponse.ok,

          key_ratios: keyRatios,

          income_statement: incomeStatement,

          balance_sheet: balanceSheet,

          status_codes: {
            key_ratios: keyRatiosResponse.status,
            income_statement:
              incomeStatementResponse.status,
            balance_sheet:
              balanceSheetResponse.status
          }
        };

      } catch (error) {
        return {
          isin,
          success: false,
          error:
            error.message ||
            "Unable to fetch fundamentals"
        };
      }
    }

    const results = await Promise.all(
      uniqueIsins.map(fetchFundamentals)
    );

    return Response.json(
      {
        status: "success",
        count: results.length,
        data: results
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=1800"
        }
      }
    );

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to fetch Health Screener fundamentals"
      },
      { status: 500 }
    );
  }
}
