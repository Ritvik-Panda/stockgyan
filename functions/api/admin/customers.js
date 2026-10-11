
import { validSession } from "./auth.js";

export async function onRequestGet(context) {
  try {
    // 1. Verify the existing admin session
    const isValid = await validSession(
      context.request,
      context.env.SESSION_SECRET
    );

    if (!isValid) {
      return Response.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // 2. Confirm database availability
    const db = context.env.DB;

    if (!db) {
      return Response.json(
        { error: "Database unavailable." },
        { status: 500 }
      );
    }

    // 3. Load customer registration statistics
    const stats = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN date(
              created_at / 1000,
              'unixepoch',
              '+5 hours',
              '+30 minutes'
            ) = date(
              'now',
              '+5 hours',
              '+30 minutes'
            )
            THEN 1 ELSE 0
          END
        ) AS today,
        SUM(
          CASE
            WHEN strftime(
              '%Y-%m',
              created_at / 1000,
              'unixepoch',
              '+5 hours',
              '+30 minutes'
            ) = strftime(
              '%Y-%m',
              'now',
              '+5 hours',
              '+30 minutes'
            )
            THEN 1 ELSE 0
          END
        ) AS this_month
      FROM customer_profiles
    `).first();

    // 4. Load the most recent registrations
    const result = await db.prepare(`
      SELECT
        full_name,
        mobile,
        email,
        mobile_verified,
        created_at
      FROM customer_profiles
      ORDER BY created_at DESC
      LIMIT 1000
    `).all();

    // 5. Return customer data only to an authenticated admin
    return Response.json(
      {
        status: "success",
        stats: {
          total: Number(stats?.total || 0),
          today: Number(stats?.today || 0),
          this_month: Number(stats?.this_month || 0)
        },
        customers: result.results || []
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {
    return Response.json(
      { error: "Unable to load customers." },
      { status: 500 }
    );
  }
}
