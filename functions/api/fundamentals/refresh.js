/*
 * StockGyan Common Fundamental Data Refresh
 *
 * Purpose:
 * Upstox → StockGyan backend → D1
 *
 * IMPORTANT:
 * This endpoint is protected by HEALTH_REFRESH_SECRET.
 * It is NOT intended to be called by normal website users.
 *
 * Initial version:
 * - Accepts a controlled list of ISINs
 * - Fetches fundamentals from Upstox
 * - Calculates StockGyan Health Score
 * - Stores the result in D1
 *
 * Later:
 * - Scheduled 6:00 AM refresh
 * - Full NSE universe refresh
 * - Common fundamental engine for all StockGyan pages
 */

export async function onRequestPost(context) {

  try {

    /* =====================================================
       SECURITY
       ===================================================== */

    const refreshSecret =
      context.env.HEALTH_REFRESH_SECRET;

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
      context.request.headers.get(
        "X-Refresh-Secret"
      );


    if (
      !suppliedSecret ||
      suppliedSecret !== refreshSecret
    ) {

      return Response.json(
        {
          status: "error",
          message: "Unauthorized"
        },
        { status: 401 }
      );

    }


    /* =====================================================
       ENVIRONMENT CHECK
       ===================================================== */

    const token =
      context.env.UPSTOX_ANALYTICS_TOKEN;

    const db =
      context.env.DB;


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


    /* =====================================================
       REQUEST
       ===================================================== */

    const body =
      await context.request.json();


    const requestedStocks =
      Array.isArray(body.stocks)
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


    /*
     * Safety limit for the initial version.
     *
     * We deliberately do NOT allow thousands of stocks
     * in one request yet.
     *
     * This prevents another accidental Upstox overload.
     */

    if (requestedStocks.length > 5) {

      return Response.json(
        {
          status: "error",
          message:
            "Maximum 5 stocks per refresh request in the initial version."
        },
        { status: 400 }
      );

    }


    /* =====================================================
       HELPERS
       ===================================================== */

    function num(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      const cleaned =
        String(value)
          .replace(/,/g, "")
          .replace(/%/g, "")
          .trim();

      const n =
        Number(cleaned);

      return Number.isFinite(n)
        ? n
        : null;

    }


    function clamp(
      value,
      min,
      max
    ) {

      return Math.min(
        max,
        Math.max(
          min,
          value
        )
      );

    }


    function relativeScore(
      company,
      sector,
      inverse
    ) {

      if (
        !Number.isFinite(company) ||
        !Number.isFinite(sector) ||
        sector <= 0
      ) {

        return null;

      }


      const difference =
        inverse
          ? (sector - company) / sector
          : (company - sector) / sector;


      return clamp(
        50 + difference * 50,
        0,
        100
      );

    }


    function findRatio(
      data,
      name
    ) {

      if (
        !data ||
        !Array.isArray(data.data)
      ) {

        return null;

      }


      const wanted =
        String(name)
          .trim()
          .toUpperCase();


      const row =
        data.data.find(
          function(item) {

            return String(
              item.name || ""
            )
            .trim()
            .toUpperCase()
            === wanted;

          }
        );


      if (!row) {

        return null;

      }


      return {

        company:
          num(row.company_value),

        sector:
          num(row.sector_value)

      };

    }


    function findNetProfitGrowth(
      income
    ) {

      if (
        !income ||
        !income.data
      ) {

        return null;

      }


      const statement =
        income.data.income_statement;


      if (
        !Array.isArray(statement)
      ) {

        return null;

      }


      const row =
        statement.find(
          function(item) {

            return String(
              item.category || ""
            )
            .trim()
            .toLowerCase()
            === "net_profit";

          }
        );


      if (
        !row ||
        !Array.isArray(row.history) ||
        !row.history.length
      ) {

        return null;

      }


      const latest =
        row.history[0];


      if (
        latest &&
        latest.change !== undefined
      ) {

        return num(
          latest.change
        );

      }


      return null;

    }


    function calculateFinancialStrength(
      balance
    ) {

      if (
        !balance ||
        !balance.data ||
        !Array.isArray(
          balance.data.history
        ) ||
        !balance.data.history.length
      ) {

        return null;

      }


      const latest =
        balance.data.history[0];


      const assets =
        num(
          latest.total_asset
        );


      const liabilities =
        num(
          latest.total_liability
        );


      if (
        !Number.isFinite(assets) ||
        !Number.isFinite(liabilities) ||
        assets <= 0
      ) {

        return null;

      }


      const liabilityRatio =
        liabilities /
        assets *
        100;


      let score;


      if (liabilityRatio <= 30) {

        score = 100;

      }
      else if (liabilityRatio <= 40) {

        score = 90;

      }
      else if (liabilityRatio <= 50) {

        score = 80;

      }
      else if (liabilityRatio <= 60) {

        score = 65;

      }
      else if (liabilityRatio <= 70) {

        score = 50;

      }
      else if (liabilityRatio <= 80) {

        score = 35;

      }
      else {

        score = 20;

      }


      return {

        score,
        liabilityRatio

      };

    }


    function growthScore(
      growth
    ) {

      if (
        !Number.isFinite(growth)
      ) {

        return null;

      }


      if (growth >= 20) return 100;
      if (growth >= 15) return 90;
      if (growth >= 10) return 80;
      if (growth >= 5) return 70;
      if (growth >= 0) return 60;
      if (growth >= -5) return 45;
      if (growth >= -10) return 30;

      return 15;

    }


    function scoreLabel(
      score
    ) {

      if (
        !Number.isFinite(score)
      ) {

        return "Insufficient Data";

      }


      if (score >= 80) return "Excellent";
      if (score >= 65) return "Good";
      if (score >= 50) return "Average";

      return "Weak";

    }


    /* =====================================================
       FETCH ONE STOCK
       ===================================================== */

    async function fetchFundamentals(
      stock
    ) {

      const isin =
        String(
          stock.isin || ""
        )
        .trim()
        .toUpperCase();


      if (
        !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(
          isin
        )
      ) {

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

        Accept:
          "application/json",

        Authorization:
          `Bearer ${token}`

      };


      try {

        /*
         * Deliberately fetch only ONE stock at a time.
         *
         * This is intentional.
         * We are protecting the Upstox API while
         * we build the centralized data engine.
         */

        const keyRatiosResponse =
          await fetch(
            baseUrl +
            "/key-ratios",
            {
              method: "GET",
              headers
            }
          );


        const keyRatios =
          await keyRatiosResponse.json();


        /*
         * Small delay before the next Upstox request.
         */

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              250
            )
        );


        const incomeResponse =
          await fetch(
            baseUrl +
            "/income-statement?type=consolidated&time_period=yearly",
            {
              method: "GET",
              headers
            }
          );


        const incomeStatement =
          await incomeResponse.json();


        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              250
            )
        );


        const balanceResponse =
          await fetch(
            baseUrl +
            "/balance-sheet?type=consolidated",
            {
              method: "GET",
              headers
            }
          );


        const balanceSheet =
          await balanceResponse.json();


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

            keyRatios:
              keyRatiosResponse.status,

            incomeStatement:
              incomeResponse.status,

            balanceSheet:
              balanceResponse.status

          }

        };

      }
      catch(error) {

        return {

          success: false,

          isin,

          message:
            error.message ||
            "Fundamental fetch failed"

        };

      }

    }


    /* =====================================================
       PROCESS STOCK
       ===================================================== */

    async function processStock(
      stock
    ) {

      const result =
        await fetchFundamentals(
          stock
        );


      if (
        !result.success
      ) {

        /*
         * IMPORTANT:
         * We do not overwrite existing good data
         * when Upstox temporarily fails.
         */

        return {

          success: false,

          symbol:
            stock.symbol || "",

          isin:
            stock.isin || "",

          company_name:
            stock.company_name || "",

          message:
            result.message ||
            "Upstox fundamental data unavailable",

          statusCodes:
            result.statusCodes || null

        };

      }


      const pe =
        findRatio(
          result.keyRatios,
          "P/E"
        );


      const roe =
        findRatio(
          result.keyRatios,
          "ROE"
        );


      const roce =
        findRatio(
          result.keyRatios,
          "ROCE"
        );


      const roa =
        findRatio(
          result.keyRatios,
          "ROA"
        );


      const earningsGrowth =
        findNetProfitGrowth(
          result.incomeStatement
        );


      const financial =
        calculateFinancialStrength(
          result.balanceSheet
        );


      /*
       * StockGyan Health factors
       *
       * Business Quality = ROE relative to sector
       * ROCE = ROCE relative to sector
       * Valuation = P/E relative to sector
       * Growth = Net profit growth
       * Financial Strength = liabilities/assets
       * Profitability = ROA relative to sector
       */

      const businessQualityScore =
        roe
          ? relativeScore(
              roe.company,
              roe.sector,
              false
            )
          : null;


      const roceScore =
        roce
          ? relativeScore(
              roce.company,
              roce.sector,
              false
            )
          : null;


      const peScore =
        pe
          ? relativeScore(
              pe.company,
              pe.sector,
              true
            )
          : null;


      const growthScoreValue =
        growthScore(
          earningsGrowth
        );


      const profitabilityScore =
        roa
          ? relativeScore(
              roa.company,
              roa.sector,
              false
            )
          : null;


      const financialScore =
        financial
          ? financial.score
          : null;


      const factors = [

        {
          score:
            businessQualityScore,
          weight: 30
        },

        {
          score:
            roceScore,
          weight: 20
        },

        {
          score:
            peScore,
          weight: 20
        },

        {
          score:
            growthScoreValue,
          weight: 15
        },

        {
          score:
            financialScore,
          weight: 10
        },

        {
          score:
            profitabilityScore,
          weight: 5
        }

      ];


      let weightedTotal = 0;
      let availableWeight = 0;


      factors.forEach(
        function(factor) {

          if (
            Number.isFinite(
              factor.score
            )
          ) {

            weightedTotal +=
              factor.score *
              factor.weight;

            availableWeight +=
              factor.weight;

          }

        }
      );


      const availableMetrics =
        factors.filter(
          function(factor) {

            return Number.isFinite(
              factor.score
            );

          }
        ).length;


      /*
       * Minimum 4 of 6 factors required.
       */

      const healthScore =
        availableMetrics >= 4 &&
        availableWeight > 0
          ? weightedTotal /
            availableWeight
          : null;


      const label =
        scoreLabel(
          healthScore
        );


      const updatedAt =
        new Date()
          .toISOString();


      /* =================================================
         SAVE TO D1
         ================================================= */

      // Save complete company fundamentals to D1 before updating the
      // existing Health Screener summary.
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
        result.isin,
        stock.symbol || "",
        stock.company_name || "",
        JSON.stringify(result.keyRatios),
        JSON.stringify(result.incomeStatement),
        JSON.stringify(result.balanceSheet),
        updatedAt
      ).run();

      await db.prepare(
        `
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

          symbol =
            excluded.symbol,

          company_name =
            excluded.company_name,

          exchange =
            excluded.exchange,

          business_quality =
            excluded.business_quality,

          roce =
            excluded.roce,

          roe =
            excluded.roe,

          pe_ratio =
            excluded.pe_ratio,

          earnings_growth =
            excluded.earnings_growth,

          debt_equity =
            excluded.debt_equity,

          profitability =
            excluded.profitability,

          health_score =
            excluded.health_score,

          quality_label =
            excluded.quality_label,

          available_metrics =
            excluded.available_metrics,

          data_status =
            excluded.data_status,

          updated_at =
            excluded.updated_at
        `
      )
      .bind(

        stock.symbol || "",

        stock.company_name || "",

        result.isin,

        stock.exchange || "NSE",

        businessQualityScore,

        roce
          ? roce.company
          : null,

        roe
          ? roe.company
          : null,

        pe
          ? pe.company
          : null,

        earningsGrowth,

        /*
         * Keep this NULL for now.
         *
         * The current Health Screener uses
         * liabilities/assets as its financial
         * strength proxy, not true Debt/Equity.
         *
         * We will add exact D/E separately.
         */

        null,

        roa
          ? roa.company
          : null,

        healthScore,

        label,

        availableMetrics,

        availableMetrics >= 4
          ? "complete"
          : "partial",

        updatedAt

      )
      .run();


      return {

        success: true,

        symbol:
          stock.symbol || "",

        company_name:
          stock.company_name || "",

        isin:
          result.isin,

        healthScore,

        label,

        availableMetrics,

        values: {

          roe:
            roe
              ? roe.company
              : null,

          roce:
            roce
              ? roce.company
              : null,

          pe:
            pe
              ? pe.company
              : null,

          earningsGrowth,

          roa:
            roa
              ? roa.company
              : null,

          financialStrength:
            financial
              ? financial.score
              : null,

          liabilityRatio:
            financial
              ? financial.liabilityRatio
              : null

        }

      };

    }


    /* =====================================================
       RUN CONTROLLED REFRESH
       ===================================================== */

    const results = [];


    for (
      const stock of requestedStocks
    ) {

      const result =
        await processStock(
          stock
        );


      results.push(
        result
      );


      /*
       * Delay between stocks.
       *
       * We are intentionally conservative.
       */

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            500
          )
      );

    }


    /* =====================================================
       RESPONSE
       ===================================================== */

    return Response.json(
      {

        status: "success",

        refreshed:
          results.filter(
            item =>
              item.success
          ).length,

        failed:
          results.filter(
            item =>
              !item.success
          ).length,

        results

      },
      {
        status: 200,

        headers: {

          "Cache-Control":
            "no-store"

        }

      }
    );


  }
  catch(error) {

    console.error(
      "Health refresh error:",
      error
    );


    return Response.json(
      {

        status: "error",

        message:
          error.message ||
          "Unable to refresh Health Screener data"

      },
      {
        status: 500
      }
    );

  }

}
