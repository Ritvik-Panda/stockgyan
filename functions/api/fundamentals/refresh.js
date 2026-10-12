
/*
 * StockGyan Common Fundamental Data Refresh
 *
 * Upstox -> StockGyan backend -> D1
 *
 * Features:
 * - Protected by HEALTH_REFRESH_SECRET
 * - Maximum 5 stocks per request
 * - Skips successfully refreshed fundamentals for 30 days
 * - Preserves existing data when Upstox fails
 * - Calculates and stores the StockGyan Health Score
 * - Reports refreshed, skipped and failed stocks separately
 */

export async function onRequestPost(context) {
  try {
    // =====================================================
    // SECURITY
    // =====================================================

    const refreshSecret = context.env.HEALTH_REFRESH_SECRET;

    if (!refreshSecret) {
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

    if (!suppliedSecret || suppliedSecret !== refreshSecret) {
      return Response.json(
        {
          status: "error",
          message: "Unauthorized"
        },
        { status: 401 }
      );
    }

    // =====================================================
    // ENVIRONMENT
    // =====================================================

    const token = context.env.UPSTOX_ANALYTICS_TOKEN;
    const db = context.env.DB;

    if (!token) {
      return Response.json(
        {
          status: "error",
          message: "Upstox token is not configured"
        },
        { status: 500 }
      );
    }

    if (!db) {
      return Response.json(
        {
          status: "error",
          message: "D1 database binding DB is not configured"
        },
        { status: 500 }
      );
    }

    // =====================================================
    // REQUEST VALIDATION
    // =====================================================

    let body;

    try {
      body = await context.request.json();
    } catch {
      return Response.json(
        {
          status: "error",
          message: "Request body must contain valid JSON"
        },
        { status: 400 }
      );
    }

    const requestedStocks = Array.isArray(body?.stocks)
      ? body.stocks
      : [];

    if (!requestedStocks.length) {
      return Response.json(
        {
          status: "error",
          message:
            "No stocks supplied. Send stocks with isin, symbol and company_name."
        },
        { status: 400 }
      );
    }

    if (requestedStocks.length > 5) {
      return Response.json(
        {
          status: "error",
          message: "Maximum 5 stocks per refresh request."
        },
        { status: 400 }
      );
    }

    // =====================================================
    // CONFIGURATION
    // =====================================================

    const FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

    // =====================================================
    // HELPERS
    // =====================================================

    function num(value) {
      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      const cleaned = String(value)
        .replace(/,/g, "")
        .replace(/%/g, "")
        .trim();

      const n = Number(cleaned);

      return Number.isFinite(n) ? n : null;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function relativeScore(company, sector, inverse) {
      if (
        !Number.isFinite(company) ||
        !Number.isFinite(sector) ||
        sector <= 0
      ) {
        return null;
      }

      const difference = inverse
        ? (sector - company) / sector
        : (company - sector) / sector;

      return clamp(50 + difference * 50, 0, 100);
    }

    function findRatio(data, name) {
      if (!data || !Array.isArray(data.data)) {
        return null;
      }

      const wanted = String(name).trim().toUpperCase();

      const row = data.data.find(item =>
        String(item.name || "").trim().toUpperCase() === wanted
      );

      if (!row) {
        return null;
      }

      return {
        company: num(row.company_value),
        sector: num(row.sector_value)
      };
    }

    function findNetProfitGrowth(income) {
      if (!income || !income.data) {
        return null;
      }

      const statement = income.data.income_statement;

      if (!Array.isArray(statement)) {
        return null;
      }

      const row = statement.find(item =>
        String(item.category || "").trim().toLowerCase()
          === "net_profit"
      );

      if (!row || !Array.isArray(row.history) || !row.history.length) {
        return null;
      }

      const latest = row.history[0];

      if (latest && latest.change !== undefined) {
        return num(latest.change);
      }

      return null;
    }

    function calculateFinancialStrength(balance) {
      if (
        !balance ||
        !balance.data ||
        !Array.isArray(balance.data.history) ||
        !balance.data.history.length
      ) {
        return null;
      }

      const latest = balance.data.history[0];
      const assets = num(latest.total_asset);
      const liabilities = num(latest.total_liability);

      if (
        !Number.isFinite(assets) ||
        !Number.isFinite(liabilities) ||
        assets <= 0
      ) {
        return null;
      }

      const liabilityRatio = liabilities / assets * 100;

      let score;

      if (liabilityRatio <= 30) score = 100;
      else if (liabilityRatio <= 40) score = 90;
      else if (liabilityRatio <= 50) score = 80;
      else if (liabilityRatio <= 60) score = 65;
      else if (liabilityRatio <= 70) score = 50;
      else if (liabilityRatio <= 80) score = 35;
      else score = 20;

      return { score, liabilityRatio };
    }

    function growthScore(growth) {
      if (!Number.isFinite(growth)) return null;

      if (growth >= 20) return 100;
      if (growth >= 15) return 90;
      if (growth >= 10) return 80;
      if (growth >= 5) return 70;
      if (growth >= 0) return 60;
      if (growth >= -5) return 45;
      if (growth >= -10) return 30;

      return 15;
    }

    function scoreLabel(score) {
      if (!Number.isFinite(score)) return "Insufficient Data";
      if (score >= 80) return "Excellent";
      if (score >= 65) return "Good";
      if (score >= 50) return "Average";

      return "Weak";
    }

    // =====================================================
    // CHECK FRESHNESS
    // =====================================================

    async function isFresh(isin) {
      /*
       * We require both records to exist before skipping.
       * This avoids skipping a company if its fundamentals
       * exist but its Health Screener summary is missing.
       */
      const existing = await db.prepare(`
        SELECT
          cf.updated_at,
          hs.isin AS health_isin
        FROM company_fundamentals cf
        LEFT JOIN health_screener_data hs
          ON hs.isin = cf.isin
        WHERE cf.isin = ?
        LIMIT 1
      `).bind(isin).first();

      if (!existing || !existing.health_isin || !existing.updated_at) {
        return false;
      }

      const timestamp = Date.parse(existing.updated_at);

      if (!Number.isFinite(timestamp)) {
        return false;
      }

      const age = Date.now() - timestamp;

      return age >= 0 && age < FRESHNESS_MS;
    }

    // =====================================================
    // FETCH ONE STOCK FROM UPSTOX
    // =====================================================

    async function fetchFundamentals(stock) {
      const isin = String(stock.isin || "")
        .trim()
        .toUpperCase();

      if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        return {
          success: false,
          isin,
          message: "Invalid ISIN"
        };
      }

      const baseUrl =
        "https://api.upstox.com/v2/fundamentals/" +
        encodeURIComponent(isin);

      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      };

      try {
        const keyRatiosResponse = await fetch(
          baseUrl + "/key-ratios",
          {
            method: "GET",
            headers
          }
        );

        const keyRatios = await keyRatiosResponse.json();

        await new Promise(resolve => setTimeout(resolve, 250));

        const incomeResponse = await fetch(
          baseUrl +
            "/income-statement?type=consolidated&time_period=yearly",
          {
            method: "GET",
            headers
          }
        );

        const incomeStatement = await incomeResponse.json();

        await new Promise(resolve => setTimeout(resolve, 250));

        const balanceResponse = await fetch(
          baseUrl + "/balance-sheet?type=consolidated",
          {
            method: "GET",
            headers
          }
        );

        const balanceSheet = await balanceResponse.json();

        return {
          success:
            keyRatiosResponse.ok &&
            incomeResponse.ok &&
            balanceResponse.ok,
          isin,
          keyRatios,
          incomeStatement,
          balanceSheet,
          statusCodes: {
            keyRatios: keyRatiosResponse.status,
            incomeStatement: incomeResponse.status,
            balanceSheet: balanceResponse.status
          }
        };
      } catch (error) {
        return {
          success: false,
          isin,
          message: error?.message || "Fundamental fetch failed"
        };
      }
    }

    // =====================================================
    // PROCESS ONE STOCK
    // =====================================================

    async function processStock(stock) {
      const isin = String(stock.isin || "")
        .trim()
        .toUpperCase();

      if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
        return {
          success: false,
          symbol: stock.symbol || "",
          isin,
          company_name: stock.company_name || "",
          message: "Invalid ISIN"
        };
      }

      // Skip before making any Upstox requests.
      try {
        if (await isFresh(isin)) {
          return {
            success: true,
            skipped: true,
            symbol: stock.symbol || "",
            isin,
            company_name: stock.company_name || "",
            message: "Fundamentals are already fresh"
          };
        }
      } catch (error) {
        /*
         * Fail closed: if the freshness query fails, do not
         * risk making unnecessary external API calls.
         */
        return {
          success: false,
          symbol: stock.symbol || "",
          isin,
          company_name: stock.company_name || "",
          message:
            "Unable to check fundamental freshness: " +
            (error?.message || "Database query failed")
        };
      }

      const result = await fetchFundamentals({
        ...stock,
        isin
      });

      if (!result.success) {
        return {
          success: false,
          symbol: stock.symbol || "",
          isin,
          company_name: stock.company_name || "",
          message:
            result.message ||
            "Upstox fundamental data unavailable",
          statusCodes: result.statusCodes || null
        };
      }

      const pe = findRatio(result.keyRatios, "P/E");
      const roe = findRatio(result.keyRatios, "ROE");
      const roce = findRatio(result.keyRatios, "ROCE");
      const roa = findRatio(result.keyRatios, "ROA");

      const earningsGrowth =
        findNetProfitGrowth(result.incomeStatement);

      const financial =
        calculateFinancialStrength(result.balanceSheet);

      // StockGyan Health Score factors.
      const businessQualityScore = roe
        ? relativeScore(roe.company, roe.sector, false)
        : null;

      const roceScore = roce
        ? relativeScore(roce.company, roce.sector, false)
        : null;

      const peScore = pe
        ? relativeScore(pe.company, pe.sector, true)
        : null;

      const growthScoreValue = growthScore(earningsGrowth);

      const profitabilityScore = roa
        ? relativeScore(roa.company, roa.sector, false)
        : null;

      const financialScore = financial
        ? financial.score
        : null;

      const factors = [
        { score: businessQualityScore, weight: 30 },
        { score: roceScore, weight: 20 },
        { score: peScore, weight: 20 },
        { score: growthScoreValue, weight: 15 },
        { score: financialScore, weight: 10 },
        { score: profitabilityScore, weight: 5 }
      ];

      let weightedTotal = 0;
      let availableWeight = 0;

      factors.forEach(factor => {
        if (Number.isFinite(factor.score)) {
          weightedTotal += factor.score * factor.weight;
          availableWeight += factor.weight;
        }
      });

      const availableMetrics = factors.filter(
        factor => Number.isFinite(factor.score)
      ).length;

      // Require at least 4 of 6 factors.
      const healthScore =
        availableMetrics >= 4 && availableWeight > 0
          ? weightedTotal / availableWeight
          : null;

      const label = scoreLabel(healthScore);
      const updatedAt = new Date().toISOString();

      // =====================================================
      // SAVE COMPLETE FUNDAMENTALS
      // =====================================================

      await db.prepare(`
        INSERT INTO company_fundamentals (
          isin,
          symbol,
          company_name,
          key_ratios,
          income_statement,
          balance_sheet,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(isin) DO UPDATE SET
          symbol = excluded.symbol,
          company_name = excluded.company_name,
          key_ratios = excluded.key_ratios,
          income_statement = excluded.income_statement,
          balance_sheet = excluded.balance_sheet,
          updated_at = excluded.updated_at
      `).bind(
        isin,
        stock.symbol || "",
        stock.company_name || "",
        JSON.stringify(result.keyRatios),
        JSON.stringify(result.incomeStatement),
        JSON.stringify(result.balanceSheet),
        updatedAt
      ).run();

      // =====================================================
      // SAVE HEALTH SCREENER SUMMARY
      // =====================================================

      await db.prepare(`
        INSERT INTO health_screener_data (
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
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(isin) DO UPDATE SET
          symbol = excluded.symbol,
          company_name = excluded.company_name,
          exchange = excluded.exchange,
          business_quality = excluded.business_quality,
          roce = excluded.roce,
          roe = excluded.roe,
          pe_ratio = excluded.pe_ratio,
          earnings_growth = excluded.earnings_growth,
          debt_equity = excluded.debt_equity,
          profitability = excluded.profitability,
          health_score = excluded.health_score,
          quality_label = excluded.quality_label,
          available_metrics = excluded.available_metrics,
          data_status = excluded.data_status,
          updated_at = excluded.updated_at
      `).bind(
        stock.symbol || "",
        stock.company_name || "",
        isin,
        stock.exchange || "NSE",
        businessQualityScore,
        roce ? roce.company : null,
        roe ? roe.company : null,
        pe ? pe.company : null,
        earningsGrowth,
        null,
        roa ? roa.company : null,
        healthScore,
        label,
        availableMetrics,
        availableMetrics >= 4 ? "complete" : "partial",
        updatedAt
      ).run();

      return {
        success: true,
        skipped: false,
        symbol: stock.symbol || "",
        company_name: stock.company_name || "",
        isin,
        healthScore,
        label,
        availableMetrics,
        values: {
          roe: roe ? roe.company : null,
          roce: roce ? roce.company : null,
          pe: pe ? pe.company : null,
          earningsGrowth,
          roa: roa ? roa.company : null,
          financialStrength: financial ? financial.score : null,
          liabilityRatio: financial ? financial.liabilityRatio : null
        }
      };
    }

    // =====================================================
    // RUN CONTROLLED REFRESH
    // =====================================================

    const results = [];

    for (const stock of requestedStocks) {
      const result = await processStock(stock);
      results.push(result);

      // Keep the existing conservative delay between stocks.
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // =====================================================
    // RESPONSE
    // =====================================================

    return Response.json(
      {
        status: "success",
        refreshed: results.filter(
          item => item.success && !item.skipped
        ).length,
        skipped: results.filter(
          item => item.skipped
        ).length,
        failed: results.filter(
          item => !item.success
        ).length,
        results
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("Health refresh error:", error);

    return Response.json(
      {
        status: "error",
        message:
          error?.message ||
          "Unable to refresh Health Screener data"
      },
      { status: 500 }
    );
  }
}
