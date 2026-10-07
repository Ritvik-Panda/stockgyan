/*
 * StockGyan Common Health Screener Data API
 *
 * Purpose:
 * Read Health Screener data from StockGyan D1.
 *
 * IMPORTANT:
 * This endpoint does NOT call Upstox.
 * Users only read the data already stored in D1.
 */

export async function onRequestGet(context) {

  try {

    const db = context.env.DB;

    if (!db) {

      return new Response(
        JSON.stringify({
          status: "error",
          message: "D1 database binding DB is not available"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }

    const result = await db.prepare(`
      SELECT
        symbol,
        company_name,
        isin,
        exchange,
        business_quality,
        roce,
        roe,
        pe_ratio,
        earnings_growth,
        debt_equity,
        profitability,
        health_score,
        quality_label,
        available_metrics,
        data_status,
        updated_at
      FROM health_screener_data
      ORDER BY
        CASE
          WHEN health_score IS NULL THEN 1
          ELSE 0
        END,
        health_score DESC,
        symbol ASC
    `).all();

    const rows = Array.isArray(result.results)
      ? result.results
      : [];

    return new Response(
      JSON.stringify({
        status: "success",
        count: rows.length,
        data: rows
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300"
        }
      }
    );

  }
  catch (error) {

    console.error(
      "Health Screener D1 read error:",
      error
    );

    return new Response(
      JSON.stringify({
        status: "error",
        message: "Unable to load Health Screener data"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  }

}
