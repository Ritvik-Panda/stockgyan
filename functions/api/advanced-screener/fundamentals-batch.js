import { validSession, json } from "../admin/auth.js";

const BATCH_SIZE = 10;
const REFRESH_DAYS = 10;
const ELIGIBLE_TYPES = ["EQ", "BE", "BZ", "SM"];
const BASE_URL = "https://api.upstox.com/v2/fundamentals";

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").replace(/%/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getRatio(ratios, name) {
  const item = (ratios || []).find(
    r => r.name?.trim().toLowerCase() === name.toLowerCase()
  );
  return parseNumber(item?.company_value);
}

function getHistoryValue(rows, category) {
  const item = (rows || []).find(
    row => row.category?.trim().toLowerCase() === category.toLowerCase()
  );
  return Array.isArray(item?.history) ? item.history : [];
}

function latestValue(history) {
  return history.length ? parseNumber(history[0]?.value) : null;
}

function growthPercent(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const current = parseNumber(history[0]?.value);
  const previous = parseNumber(history[1]?.value);
  if (current === null || previous === null || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function getBalanceValue(history, key) {
  return history.length ? parseNumber(history[0]?.[key]) : null;
}

async function fetchJson(url, token, required = false) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== "success") {
      if (required) {
        throw new Error(result?.message || `Upstox HTTP ${response.status}`);
      }
      return null;
    }
    return result.data ?? null;
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

async function saveFailure(db, companyId, error) {
  await db.prepare(`
    INSERT INTO fundamentals_sync_failures
      (company_id, attempts, last_error, next_retry_at, updated_at)
    VALUES (?, 1, ?, datetime('now', '+1 hour'), CURRENT_TIMESTAMP)
    ON CONFLICT(company_id) DO UPDATE SET
      attempts = fundamentals_sync_failures.attempts + 1,
      last_error = excluded.last_error,
      next_retry_at = datetime('now', '+1 hour'),
      updated_at = CURRENT_TIMESTAMP
  `).bind(companyId, String(error).slice(0, 500)).run();
}

async function fetchAndSave(db, token, company) {
  const isin = encodeURIComponent(company.isin);

  // Key ratios remain the required source for the existing working screeners.
  const ratiosData = await fetchJson(
    `${BASE_URL}/${isin}/key-ratios`,
    token,
    true
  );

  const ratios = Array.isArray(ratiosData) ? ratiosData : [];
  const pe = getRatio(ratios, "P/E");
  const pb = getRatio(ratios, "P/B");
  const roa = getRatio(ratios, "ROA");
  const roe = getRatio(ratios, "ROE");
  const roce = getRatio(ratios, "ROCE");
  const evEbitda = getRatio(ratios, "EV/EBITDA");

  if ([pe, roe, roce, pb, roa, evEbitda].every(value => value === null)) {
    throw new Error("No usable Upstox key-ratio values returned");
  }

  // These supplementary endpoints are optional. A failure here must not
  // block P/E, ROE or ROCE from being saved.
  const incomeData = await fetchJson(
    `${BASE_URL}/${isin}/income-statement?type=consolidated&time_period=yearly`,
    token
  );
  const cashData = await fetchJson(
    `${BASE_URL}/${isin}/cash-flow?type=consolidated`,
    token
  );
  const balanceData = await fetchJson(
    `${BASE_URL}/${isin}/balance-sheet?type=consolidated`,
    token
  );

  const incomeRows = incomeData?.income_statement || [];
  const revenueHistory = getHistoryValue(incomeRows, "revenue");
  const operatingProfitHistory = getHistoryValue(incomeRows, "operating_profit");
  const netProfitHistory = getHistoryValue(incomeRows, "net_profit");
  const cashHistory = getHistoryValue(cashData?.cash_flow || [], "operating");
  const balanceHistory = balanceData?.history || [];

  const annualRevenue = latestValue(revenueHistory);
  const operatingProfit = latestValue(operatingProfitHistory);
  const annualNetProfit = latestValue(netProfitHistory);
  const operatingCashFlow = latestValue(cashHistory);
  const totalAssets = getBalanceValue(balanceHistory, "total_asset");
  const totalLiabilities = getBalanceValue(balanceHistory, "total_liability");
  const salesGrowth = growthPercent(revenueHistory);
  const profitGrowth = growthPercent(netProfitHistory);

  const asOfDate = new Date().toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Kolkata" }
  );

  await db.prepare(`
    INSERT INTO fundamentals (
      company_id, as_of_date,
      pe, pb, roa_pct, roe_pct, roce_pct, ev_ebitda,
      annual_revenue_cr, operating_profit_cr, annual_net_profit_cr,
      operating_cash_flow_cr, total_assets_cr, total_liabilities_cr,
      sales_growth_pct, profit_growth_pct,
      source, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

    ON CONFLICT(company_id, as_of_date)
    DO UPDATE SET
      pe = COALESCE(excluded.pe, fundamentals.pe),
      pb = COALESCE(excluded.pb, fundamentals.pb),
      roa_pct = COALESCE(excluded.roa_pct, fundamentals.roa_pct),
      roe_pct = COALESCE(excluded.roe_pct, fundamentals.roe_pct),
      roce_pct = COALESCE(excluded.roce_pct, fundamentals.roce_pct),
      ev_ebitda = COALESCE(excluded.ev_ebitda, fundamentals.ev_ebitda),
      annual_revenue_cr = COALESCE(excluded.annual_revenue_cr, fundamentals.annual_revenue_cr),
      operating_profit_cr = COALESCE(excluded.operating_profit_cr, fundamentals.operating_profit_cr),
      annual_net_profit_cr = COALESCE(excluded.annual_net_profit_cr, fundamentals.annual_net_profit_cr),
      operating_cash_flow_cr = COALESCE(excluded.operating_cash_flow_cr, fundamentals.operating_cash_flow_cr),
      total_assets_cr = COALESCE(excluded.total_assets_cr, fundamentals.total_assets_cr),
      total_liabilities_cr = COALESCE(excluded.total_liabilities_cr, fundamentals.total_liabilities_cr),
      sales_growth_pct = COALESCE(excluded.sales_growth_pct, fundamentals.sales_growth_pct),
      profit_growth_pct = COALESCE(excluded.profit_growth_pct, fundamentals.profit_growth_pct),
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    company.id,
    asOfDate,
    pe, pb, roa, roe, roce, evEbitda,
    annualRevenue, operatingProfit, annualNetProfit,
    operatingCashFlow, totalAssets, totalLiabilities,
    salesGrowth, profitGrowth,
    "Upstox Fundamentals APIs"
  ).run();

  await db.prepare(`
    DELETE FROM fundamentals_sync_failures
    WHERE company_id = ?
  `).bind(company.id).run();

  return {
    symbol: company.symbol,
    success: true,
    pe, pb, roa_pct: roa, roe_pct: roe, roce_pct: roce,
    ev_ebitda: evEbitda,
    annual_revenue_cr: annualRevenue,
    operating_profit_cr: operatingProfit,
    annual_net_profit_cr: annualNetProfit,
    operating_cash_flow_cr: operatingCashFlow,
    total_assets_cr: totalAssets,
    total_liabilities_cr: totalLiabilities,
    sales_growth_pct: salesGrowth,
    profit_growth_pct: profitGrowth
  };
}

async function countFailures(db) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM fundamentals_sync_failures
  `).first();
  return Number(row?.total || 0);
}

async function finishCycle(db) {
  const failures = await countFailures(db);

  if (failures === 0) {
    await db.prepare(`
      UPDATE fundamentals_sync_state
      SET status = 'completed',
          total_failed = 0,
          last_completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();
    return { status: "completed", failed_pending: 0 };
  }

  await db.prepare(`
    UPDATE fundamentals_sync_state
    SET status = 'retry_pending',
        total_failed = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(failures).run();

  return { status: "retry_pending", failed_pending: failures };
}

async function getEligibleCount(db, afterId = 0) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM companies
    WHERE exchange = 'NSE'
      AND active = 1
      AND isin LIKE 'INE%'
      AND instrument_type IN ('EQ', 'BE', 'BZ', 'SM')
      AND id > ?
  `).bind(afterId).first();
  return Number(row?.total || 0);
}

export async function onRequestPost({ request, env }) {
  if (!(await validSession(request, env.SESSION_SECRET))) {
    return json({ success: false, message: "Unauthorized" }, 401);
  }

  const db = env.ADVANCED_DB;
  const token = env.UPSTOX_ANALYTICS_TOKEN2;

  if (!db || !token) {
    return json({
      success: false,
      message: "ADVANCED_DB or Upstox token is not configured"
    }, 500);
  }

  try {
    let state = await db.prepare(`
      SELECT * FROM fundamentals_sync_state
      WHERE id = 1
    `).first();

    if (!state) {
      return json({
        success: false,
        message: "Fundamentals sync state is missing"
      }, 500);
    }

    // Start a new full cycle only after the existing 10-day interval.
    if (state.status === "completed" && state.last_completed_at) {
      const completedTime = Date.parse(
        state.last_completed_at.replace(" ", "T") + "Z"
      );
      const interval = REFRESH_DAYS * 86400000;
      const age = Date.now() - completedTime;

      if (Number.isFinite(completedTime) && age < interval) {
        return json({
          success: true,
          message: "Fundamentals refresh is not due yet",
          last_completed_at: state.last_completed_at,
          next_refresh_in_days: Math.ceil((interval - age) / 86400000)
        });
      }

      await db.prepare(`
        UPDATE fundamentals_sync_state
        SET last_company_id = 0,
            total_processed = 0,
            total_success = 0,
            total_failed = 0,
            status = 'running',
            last_completed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).run();

      state = await db.prepare(`
        SELECT * FROM fundamentals_sync_state
        WHERE id = 1
      `).first();
    }

    const retryMode =
      state.status === "retry_pending" ||
      state.status === "completed_with_failures";

    let companies = [];

    if (retryMode) {
      const retryResult = await db.prepare(`
        SELECT c.id, c.symbol, c.isin, c.instrument_type
        FROM fundamentals_sync_failures f
        JOIN companies c ON c.id = f.company_id
        WHERE f.next_retry_at <= datetime('now')
        ORDER BY f.attempts ASC, c.id ASC
        LIMIT ?
      `).bind(BATCH_SIZE).all();

      companies = retryResult.results || [];

      if (companies.length === 0) {
        const pending = await countFailures(db);
        await db.prepare(`
          UPDATE fundamentals_sync_state
          SET status = 'retry_pending',
              total_failed = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `).bind(pending).run();

        return json({
          success: true,
          message: "Waiting for failed companies retry time",
          status: "retry_pending",
          failed_pending: pending
        });
      }
    } else {
      const companyResult = await db.prepare(`
        SELECT id, symbol, isin, instrument_type
        FROM companies
        WHERE exchange = 'NSE'
          AND active = 1
          AND isin LIKE 'INE%'
          AND instrument_type IN ('EQ', 'BE', 'BZ', 'SM')
          AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `).bind(state.last_company_id || 0, BATCH_SIZE).all();

      companies = companyResult.results || [];

      if (companies.length === 0) {
        const completion = await finishCycle(db);
        return json({
          success: true,
          message: "Initial company scan finished",
          ...completion
        });
      }
    }

    let successful = 0;
    let failed = 0;
    const results = [];

    // Sequential company processing: at most four fundamentals requests per
    // company, without parallel bursts. Supplementary failures remain NULL.
    for (const company of companies) {
      try {
        if (!company.isin || !company.isin.startsWith("INE")) {
          throw new Error("Invalid company ISIN");
        }
        if (!ELIGIBLE_TYPES.includes(company.instrument_type)) {
          throw new Error("Ineligible instrument type");
        }

        results.push(await fetchAndSave(db, token, company));
        successful++;
      } catch (error) {
        await saveFailure(db, company.id, error.message);
        results.push({
          symbol: company.symbol,
          success: false,
          message: error.message
        });
        failed++;
      }
    }

    // Retry batches do not move the main company cursor.
    if (retryMode) {
      const completion = await finishCycle(db);
      return json({
        success: true,
        message: "Failed-company retry batch processed",
        batch_size: companies.length,
        successful,
        failed,
        ...completion,
        results
      });
    }

    const lastCompanyId = Math.max(...companies.map(company => company.id));
    const remainingCompanies = await getEligibleCount(db, lastCompanyId);
    const pendingFailures = await countFailures(db);
    const scanFinished = remainingCompanies === 0;
    const nextStatus = scanFinished
      ? (pendingFailures > 0 ? "retry_pending" : "completed")
      : "running";

    await db.prepare(`
      UPDATE fundamentals_sync_state
      SET last_company_id = ?,
          total_processed = total_processed + ?,
          total_success = total_success + ?,
          total_failed = ?,
          status = ?,
          last_completed_at = CASE
            WHEN ? = 1 AND ? = 0
            THEN CURRENT_TIMESTAMP
            ELSE last_completed_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(
      lastCompanyId,
      companies.length,
      successful,
      pendingFailures,
      nextStatus,
      scanFinished ? 1 : 0,
      pendingFailures
    ).run();

    return json({
      success: true,
      message: "Fundamentals batch processed",
      database: "stockgyan-advanced-db",
      batch_size: companies.length,
      successful,
      failed,
      remaining_companies: remainingCompanies,
      total_failed_pending: pendingFailures,
      status: nextStatus,
      results
    });
  } catch (error) {
    return json({
      success: false,
      message: error.message || "Fundamentals batch failed"
    }, 500);
  }
}
