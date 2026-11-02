
function getNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(String(value).replace("%", "").trim());
  return Number.isFinite(number) ? number : null;
}

export async function onRequestPost({ env }) {
  const db = env.ADVANCED_DB;
  const token = env.UPSTOX_ANALYTICS_TOKEN2;

  if (!db) {
    return Response.json({
      success: false,
      message: "ADVANCED_DB binding not configured"
    }, { status: 500 });
  }

  if (!token) {
    return Response.json({
      success: false,
      message: "UPSTOX_ANALYTICS_TOKEN2 secret not configured"
    }, { status: 500 });
  }

  const symbols = [
    "HDFCBANK",
    "ICICIBANK",
    "INFY",
    "RELIANCE",
    "TCS"
  ];

  const placeholders = symbols.map(() => "?").join(",");

  try {
    const result = await db.prepare(`
      SELECT id, symbol, isin
      FROM companies
      WHERE exchange = 'NSE'
        AND symbol IN (${placeholders})
        AND isin IS NOT NULL
        AND isin != ''
    `).bind(...symbols).all();

    const companies = result.results || [];

    if (companies.length !== 5) {
      return Response.json({
        success: false,
        message: "Expected five companies but did not find all five.",
        found: companies.length
      }, { status: 400 });
    }

    const asOfDate = new Date().toISOString().slice(0, 10);
    const companyResults = [];

    // Fetch sequentially to avoid unnecessary API pressure.
    for (const company of companies) {
      try {
        const response = await fetch(
          `https://api.upstox.com/v2/fundamentals/${encodeURIComponent(company.isin)}/key-ratios`,
          {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "Authorization": `Bearer ${token}`
            }
          }
        );

        const data = await response.json();

        if (!response.ok || data.status !== "success") {
          companyResults.push({
            symbol: company.symbol,
            success: false,
            http_status: response.status,
            message: data.message || "Upstox fundamentals request failed"
          });
          continue;
        }

        const ratios = data.data || [];

        const findRatio = (name) => {
          const item = ratios.find(
            ratio => ratio.name?.toLowerCase() === name.toLowerCase()
          );
          return item
            ? getNumericValue(item.company_value)
            : null;
        };

        const pe = findRatio("P/E");
        const roe = findRatio("ROE");
        const roce = findRatio("ROCE");

        await db.prepare(`
          INSERT INTO fundamentals (
            company_id,
            as_of_date,
            pe,
            roe_pct,
            roce_pct,
            source,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

          ON CONFLICT(company_id, as_of_date)
          DO UPDATE SET
            pe = excluded.pe,
            roe_pct = excluded.roe_pct,
            roce_pct = excluded.roce_pct,
            source = excluded.source,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          company.id,
          asOfDate,
          pe,
          roe,
          roce,
          "Upstox Fundamentals Key Ratios"
        ).run();

        companyResults.push({
          symbol: company.symbol,
          isin: company.isin,
          success: true,
          pe,
          roe_pct: roe,
          roce_pct: roce
        });

      } catch (error) {
        companyResults.push({
          symbol: company.symbol,
          success: false,
          message: error.message
        });
      }
    }

    const successful = companyResults.filter(item => item.success).length;

    return Response.json({
      success: successful === 5,
      message: "Five-company fundamentals test completed",
      database: "stockgyan-advanced-db",
      as_of_date: asOfDate,
      successful,
      failed: 5 - successful,
      results: companyResults
    });

  } catch (error) {
    return Response.json({
      success: false,
      message: error.message || "Fundamentals test failed"
    }, { status: 500 });
  }
}
