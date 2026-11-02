
import { validSession, json } from "../admin/auth.js";

const BATCH_SIZE = 10;
const REFRESH_DAYS = 10;

function getRatio(ratios, name) {
  const item = ratios.find(
    r => r.name?.toLowerCase() === name.toLowerCase()
  );

  if (!item || item.company_value == null) return null;

  const value = Number(
    String(item.company_value).replace("%", "").trim()
  );

  return Number.isFinite(value) ? value : null;
}

async function saveFailure(db, companyId, error) {
  await db.prepare(`
    INSERT INTO fundamentals_sync_failures (
      company_id, attempts, last_error, next_retry_at, updated_at
    )
    VALUES (?, 1, ?, datetime('now', '+1 hour'), CURRENT_TIMESTAMP)
    ON CONFLICT(company_id) DO UPDATE SET
      attempts = fundamentals_sync_failures.attempts + 1,
      last_error = excluded.last_error,
      next_retry_at = datetime('now', '+1 hour'),
      updated_at = CURRENT_TIMESTAMP
  `).bind(companyId, String(error).slice(0, 500)).run();
}

async function fetchAndSave(db, token, company) {
  const response = await fetch(
    `https://api.upstox.com/v2/fundamentals/${encodeURIComponent(company.isin)}/key-ratios`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`
      }
    }
  );

  const result = await response.json();

  if (!response.ok || result.status !== "success" ||
      !Array.isArray(result.data)) {
    throw new Error(
      result.message || `Upstox HTTP ${response.status}`
    );
  }

  const ratios = result.data;
  const pe = getRatio(ratios, "P/E");
  const roe = getRatio(ratios, "ROE");
  const roce = getRatio(ratios, "ROCE");

  const asOfDate = new Date().toISOString().slice(0, 10);

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
      pe = COALESCE(excluded.pe, fundamentals.pe),
      roe_pct = COALESCE(excluded.roe_pct, fundamentals.roe_pct),
      roce_pct = COALESCE(excluded.roce_pct, fundamentals.roce_pct),
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

  await db.prepare(`
    DELETE FROM fundamentals_sync_failures
    WHERE company_id = ?
  `).bind(company.id).run();

  return { symbol: company.symbol, success: true, pe, roe_pct: roe, roce_pct: roce };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.ADVANCED_DB;
  const token = env.UPSTOX_ANALYTICS_TOKEN2;

  // Reuse StockGyan's existing admin login.
  const authenticated = await validSession(
    request,
    env.SESSION_SECRET
  );

  if (!authenticated) {
    return json({ success: false, message: "Unauthorized" }, 401);
  }

  if (!db || !token) {
    return json({
      success: false,
      message: "ADVANCED_DB or Upstox token is not configured"
    }, 500);
  }

  try {
    const stateResult = await db.prepare(`
      SELECT * FROM fundamentals_sync_state WHERE id = 1
    `).first();

    if (!stateResult) {
      return json({
        success: false,
        message: "Fundamentals sync state is missing"
      }, 500);
    }

    const state = stateResult;

    // Once a full import is complete, wait 10 days
    // before starting the next full refresh.
    if (state.status === "completed" && state.last_completed_at) {
      const completedTime = Date.parse(
        state.last_completed_at.replace(" ", "T") + "Z"
      );

      const age = Date.now() - completedTime;
      const refreshInterval = REFRESH_DAYS * 24 * 60 * 60 * 1000;

      if (Number.isFinite(completedTime) &&
          age < refreshInterval) {
        return json({
          success: true,
          message: "Fundamentals refresh is not due yet",
          last_completed_at: state.last_completed_at,
          next_refresh_in_days: Math.ceil(
            (refreshInterval - age) / (24 * 60 * 60 * 1000)
          )
        });
      }

      // Start a fresh 10-day refresh cycle.
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
    }

    // If the full company list has already been scanned,
    // process failed companies whose retry time has arrived.
    let companies = [];

    if (
      state.status === "completed_with_failures" ||
      state.status === "retry_pending"
    ) {
      const retryResult = await db.prepare(`
        SELECT c.id, c.symbol, c.isin
        FROM fundamentals_sync_failures f
        JOIN companies c ON c.id = f.company_id
        WHERE f.next_retry_at <= datetime('now')
        ORDER BY f.attempts ASC, c.id ASC
        LIMIT ?
      `).bind(BATCH_SIZE).all();

      companies = retryResult.results || [];

      if (!companies.length) {
        const remaining = await db.prepare(`
          SELECT COUNT(*) AS total
          FROM fundamentals_sync_failures
        `).first();

        return json({
          success: true,
          message: "No failed companies are due for retry yet",
          retry_pending: remaining?.total || 0
        });
      }
    } else {
      const companyResult = await db.prepare(`
        SELECT id, symbol, isin
        FROM companies
        WHERE exchange = 'NSE'
          AND active = 1
          AND isin IS NOT NULL
          AND isin != ''
          AND id > ?
        ORDER BY id ASC
        LIMIT ?
      `).bind(
        state.last_company_id || 0,
        BATCH_SIZE
      ).all();

      companies = companyResult.results || [];
    }

    if (!companies.length) {
      const failed = await db.prepare(`
        SELECT COUNT(*) AS total
        FROM fundamentals_sync_failures
      `).first();

      const status = failed?.total > 0
        ? "completed_with_failures"
        : "completed";

      await db.prepare(`
        UPDATE fundamentals_sync_state
        SET status = ?,
            last_completed_at = CURRENT_TIMESTAMP,
            total_failed = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `).bind(status, failed?.total || 0).run();

      return json({
        success: true,
        message: "Fundamentals import completed",
        status,
        failed_companies: failed?.total || 0
      });
    }

    const results = [];
    let successful = 0;
    let failed = 0;

    for (const company of companies) {
      try {
        const result = await fetchAndSave(db, token, company);
        results.push(result);
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

    const lastCompanyId = Math.max(
      ...companies.map(company => company.id)
    );

    const remainingCompanies = await db.prepare(`
      SELECT COUNT(*) AS total
      FROM companies
      WHERE exchange = 'NSE'
        AND active = 1
        AND isin IS NOT NULL
        AND isin != ''
        AND id > ?
    `).bind(lastCompanyId).first();

    const failureCount = await db.prepare(`
      SELECT COUNT(*) AS total
      FROM fundamentals_sync_failures
    `).first();

    const isInitialScanComplete = remainingCompanies?.total === 0;

    const newStatus = isInitialScanComplete
      ? (failureCount?.total > 0
          ? "completed_with_failures"
          : "completed")
      : "running";

    const updateState = await db.prepare(`
      UPDATE fundamentals_sync_state
      SET last_company_id = ?,
          total_processed = total_processed + ?,
          total_success = total_success + ?,
          total_failed = ?,
          status = ?,
          last_completed_at = CASE
            WHEN ? = 1 THEN CURRENT_TIMESTAMP
            ELSE last_completed_at
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(
      lastCompanyId,
      companies.length,
      successful,
      failureCount?.total || 0,
      newStatus,
      isInitialScanComplete ? 1 : 0
    ).run();

    return json({
      success: true,
      message: "Fundamentals batch processed",
      database: "stockgyan-advanced-db",
      batch_size: companies.length,
      successful,
      failed,
      remaining_companies: remainingCompanies?.total || 0,
      total_failed_pending: failureCount?.total || 0,
      status: newStatus,
      results
    });

  } catch (error) {
    return json({
      success: false,
      message: error.message || "Fundamentals batch failed"
    }, 500);
  }
}
