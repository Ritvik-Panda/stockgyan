/*
 * StockGyan Controlled Fundamental Batch Runner
 *
 * Purpose:
 *   NSE Universe -> controlled 5-stock batch -> existing refresh engine -> D1
 *
 * IMPORTANT:
 *   - This endpoint NEVER calls Upstox directly.
 *   - It reuses /api/fundamentals/refresh.
 *   - Maximum 5 stocks per run.
 *   - It is protected by HEALTH_REFRESH_SECRET.
 *
 * Test example:
 *   POST /api/fundamentals/refresh-batch
 *   Header: X-Refresh-Secret: <secret>
 *   Body: {"offset":0}
 *
 * The response returns nextOffset so a scheduler can continue later.
 */

export async function onRequestPost(context) {
  try {
    const secret = context.env.HEALTH_REFRESH_SECRET;

    if (!secret) {
      return Response.json(
        {
          status: "error",
          message: "Health refresh secret is not configured"
        },
        { status: 500 }
      );
    }

    const suppliedSecret =
      context.request.headers.get("X-Refresh-Secret");

    if (!suppliedSecret || suppliedSecret !== secret) {
      return Response.json(
        {
          status: "error",
          message: "Unauthorized"
        },
        { status: 401 }
      );
    }

    const body = await context.request.json().catch(() => ({}));

    const rawOffset =
      Number.isFinite(Number(body.offset))
        ? Number(body.offset)
        : 0;

    const offset = Math.max(
      0,
      Math.floor(rawOffset)
    );

    const rawLimit =
      Number.isFinite(Number(body.limit))
        ? Number(body.limit)
        : 5;

    const limit = Math.min(
      5,
      Math.max(
        1,
        Math.floor(rawLimit)
      )
    );

    /*
     * Load the same StockGyan NSE universe used by /screener1.
     * This request is to StockGyan, not Upstox.
     */
    const universeUrl =
      new URL(
        "/api/health-screener/universe",
        context.request.url
      );

    const universeResponse =
      await fetch(
        universeUrl.toString(),
        {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        }
      );

    const universeData =
      await universeResponse.json();

    if (
      !universeResponse.ok ||
      universeData.status !== "success" ||
      !Array.isArray(universeData.data)
    ) {
      return Response.json(
        {
          status: "error",
          message:
            universeData.message ||
            "Unable to load StockGyan NSE universe"
        },
        { status: 502 }
      );
    }

    const universe =
      universeData.data
        .filter(function(stock) {
          return (
            stock &&
            stock.isin &&
            /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(
              String(stock.isin).toUpperCase()
            )
          );
        })
        .map(function(stock) {
          return {
            symbol:
              stock.symbol ||
              stock.trading_symbol ||
              "",

            company_name:
              stock.name ||
              stock.company_name ||
              stock.symbol ||
              "",

            isin:
              String(stock.isin)
                .trim()
                .toUpperCase(),

            exchange:
              stock.exchange ||
              "NSE"
          };
        });

    const total = universe.length;

    if (offset >= total) {
      return Response.json(
        {
          status: "success",
          message: "No stocks remaining at this offset.",
          offset,
          nextOffset: 0,
          total,
          batchSize: 0,
          refreshed: 0,
          failed: 0,
          completed: true
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }

    const stocks =
      universe.slice(
        offset,
        offset + limit
      );

    /*
     * Reuse the existing protected refresh engine.
     * That endpoint remains responsible for:
     *   Upstox -> calculations -> D1
     */
    const refreshUrl =
      new URL(
        "/api/fundamentals/refresh",
        context.request.url
      );

    const refreshResponse =
      await fetch(
        refreshUrl.toString(),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Refresh-Secret": secret
          },
          body: JSON.stringify({
            stocks
          })
        }
      );

    const refreshData =
      await refreshResponse.json();

    if (!refreshResponse.ok) {
      return Response.json(
        {
          status: "error",
          message:
            refreshData.message ||
            "Controlled fundamental refresh failed",
          offset,
          nextOffset: offset,
          total,
          batchSize: stocks.length,
          refreshStatus: refreshResponse.status
        },
        { status: 502 }
      );
    }

    const nextOffset =
      offset + stocks.length >= total
        ? 0
        : offset + stocks.length;

    return Response.json(
      {
        status: "success",
        offset,
        nextOffset,
        total,
        batchSize: stocks.length,
        completed:
          offset + stocks.length >= total,
        refreshed:
          Number(refreshData.refreshed || 0),
        failed:
          Number(refreshData.failed || 0),
        results:
          Array.isArray(refreshData.results)
            ? refreshData.results
            : []
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    console.error(
      "Controlled Health batch error:",
      error
    );

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to run controlled Health batch"
      },
      { status: 500 }
    );
  }
}
