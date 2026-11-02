
import { validSession, json } from "../admin/auth.js";

const BATCH_SIZE = 10;
const REFRESH_DAYS = 10;

const ELIGIBLE_TYPES = ["EQ", "BE", "BZ", "SM"];

function getRatio(ratios, name) {
  const item = ratios.find(
    r => r.name?.trim().toLowerCase() === name.toLowerCase()
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

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(`Invalid Upstox response: HTTP ${response.status}`);
  }

  if (
    !response.ok ||
    result.status !== "success" ||
    !Array.isArray(result.data)
  ) {
    throw new Error(
      result.message || `Upstox HTTP ${response.status}`
    );
  }

  const pe = getRatio(result.data, "P/E");
  const roe = getRatio(result.data, "ROE");
  const roce = getRatio(result.data, "ROCE");

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

  return {
    symbol: company.symbol,
    instrument_type: company.instrument_type,
    success: true,
    pe,
    roe_pct: roe,
    roce_pct: roce
  };
}

async function countFailures(db) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM fundamentals_sync_failures
  `).first();

  return row?.total || 0;
}

async function completeCycle(db) {
  const failures = await countFailures(db);

  if (failures === 0) {
    await db.prepare(`
      UPDATE fundamentals_sync_state
      SET status = 'completed',
          last_completed_at = CURRENT_TIMESTAMP,
          total_failed = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run();

    return {
      status: "completed",
      failed_pending: 0
    };
  }

  await db.prepare(`
    UPDATE fundamentals_sync_state
    SET status = 'retry_pending',
        total_failed = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(failures).run();

  return {
    status: "retry_pending",
    failed_pending: failures
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Existing StockGyan admin authentication.
  const authenticated = await validSession(
    request,
    env.SESSION_SECRET
  );

  if (!authenticated) {
    return json({
      success: false,
      message: "Unauthorized"
    }, 401);
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
      SELECT * FROM fundamentals_sync_state WHERE id = 1
    `).first();

    if (!state) {
      return json({
        success: false,
        message: "Fundamentals sync state is missing"
      }, 500);
    }

    // Start a new full cycle only after 10 days
    // from the previous completely successful cycle.
    if (state.status === "completed" && state.last_completed_at) {
      const completedTime = Date.parse(
        state.last_completed_at.replace(" ", "T") + "Z"
      );

      const interval = REFRESH_DAYS * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - completedTime;

      if (Number.isFinite(completedTime) && elapsed < interval) {
        return json({
          success: true,
          message: "Next fundamentals refresh is not due yet",
          last_completed_at: state.last_completed_at,
          next_refresh_in_days: Math.ceil(
            (interval - elapsed) / (24 * 60 * 60 * 1000)
          )
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
        SELECT * FROM fundamentals_sync_state WHERE id = 1
      `).first();
    }

    let companies = [];
    let retryMode = state.status === "retry_pending";

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
        const completion = await completeCycle(db);

        return json({
          success: true,
          message: completion.failed_pending
            ? "Waiting for failed companies to become eligible for retry"
            : "Fundamentals import completed",
          ...completion
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
      `).bind(
        state.last_company_id || 0,
        BATCH_SIZE
      ).all();

      companies = companyResult.results || [];

      if (companies.length === 0) {
        const completion = await completeCycle(db);

        return json({
          success: true,
          message: "Initial company scan finished",
          ...completion
        });
      }
    }

    const results = [];
    let successful = 0;
    let failed = 0;

    // Sequential requests to keep API usage controlled.
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

    let remainingCompanies = 0;

    if (!retryMode) {
      const remaining = await db.prepare(`
        SELECT COUNT(*) AS total
        FROM companies
        WHERE exchange = 'NSE'
          AND active = 1
          AND isin LIKE 'INE%'
          AND instrument_type IN ('EQ', 'BE', 'BZ', 'SM')
          AND id > ?
      `).bind(
        Math.max(...companies.map(c => c.id))
      ).first();

      remainingCompanies = remaining?.total || 0;
    }

    const pendingFailures = await countFailures();

    if (retryMode) {
      const completion = await completeCycle(db);

      return json({
        success: true,
        message: "Failed-company retry batch processed",
        batch_size: companies.length,
        successful,
        failed,
        failed_pending: completion.failed_pending,
        status: completion.status,
        results
      });
    }

    const lastCompanyId = Math.max(...companies.map(c => c.id));
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
