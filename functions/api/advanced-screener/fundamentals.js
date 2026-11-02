export async function onRequestGet({ env }) {
  const db = env.ADVANCED_DB;
  if (!db) {
    return Response.json(
      { success: false, message: "ADVANCED_DB is not configured" },
      { status: 500 }
    );
  }

  try {
    const result = await db.prepare(`
      SELECT
        c.symbol,
        c.isin,
        f.pe,
        f.pb,
        f.roe_pct,
        f.roce_pct,
        f.roa_pct,
        f.ev_ebitda,
        f.annual_revenue_cr,
        f.operating_profit_cr,
        f.annual_net_profit_cr,
        f.operating_cash_flow_cr,
        f.total_assets_cr,
        f.total_liabilities_cr,
        f.sales_growth_pct,
        f.profit_growth_pct,
        f.as_of_date
      FROM fundamentals f
      JOIN companies c ON c.id = f.company_id
      JOIN (
        SELECT company_id, MAX(as_of_date) AS latest_date
        FROM fundamentals
        GROUP BY company_id
      ) latest
        ON latest.company_id = f.company_id
       AND latest.latest_date = f.as_of_date
      WHERE c.exchange = 'NSE'
        AND c.active = 1
        AND c.isin LIKE 'INE%'
        AND c.instrument_type IN ('EQ', 'BE', 'BZ', 'SM')
    `).all();

    const rows = result.results || [];
    return Response.json(
      { success: true, count: rows.length, data: rows },
      { headers: { "Cache-Control": "public, max-age=300" } }
    );
  } catch (error) {
    return Response.json(
      { success: false, message: error.message || "Fundamentals query failed" },
      { status: 500 }
    );
  }
}
