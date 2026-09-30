import {
  verifySessionToken,
  SESSION_COOKIE_NAME
} from "../../lib/session.js";

function getSessionEmail(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";

  const cookies = cookieHeader
    .split(";")
    .map(item => item.trim());

  const sessionCookie = cookies.find(
    item => item.startsWith(`${SESSION_COOKIE_NAME}=`)
  );

  if (!sessionCookie) {
    return null;
  }

  const token = sessionCookie.substring(
    SESSION_COOKIE_NAME.length + 1
  );

  return verifySessionToken(
    token,
    env.SESSION_SECRET
  );
}

async function authenticate(context) {
  const { request, env } = context;

  if (!env.DB) {
    return {
      error: Response.json(
        {
          status: "error",
          message: "Database binding DB is not configured"
        },
        { status: 500 }
      )
    };
  }

  if (!env.SESSION_SECRET) {
    return {
      error: Response.json(
        {
          status: "error",
          message: "SESSION_SECRET is not configured"
        },
        { status: 500 }
      )
    };
  }

  const session = await getSessionEmail(
    request,
    env
  );

  if (!session) {
    return {
      error: Response.json(
        {
          status: "error",
          message: "Not authenticated"
        },
        { status: 401 }
      )
    };
  }

  return {
    env,
    session
  };
}


/* =====================================================
   GET HOLDINGS
   /api/portfolio/holdings?portfolio_id=1
===================================================== */

export async function onRequestGet(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, session } = auth;

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        instrument_key TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        exchange TEXT,
        quantity REAL NOT NULL,
        avg_price REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(portfolio_id, instrument_key)
      )
    `).run();

    const url = new URL(request.url);

    const portfolioId = Number(
      url.searchParams.get("portfolio_id")
    );

    if (!Number.isInteger(portfolioId) || portfolioId <= 0) {
      return Response.json(
        {
          status: "error",
          message: "Valid portfolio_id is required"
        },
        { status: 400 }
      );
    }

    const portfolio = await env.DB
      .prepare(`
        SELECT id
        FROM portfolios
        WHERE id = ?
        AND user_email = ?
      `)
      .bind(
        portfolioId,
        session.email
      )
      .first();

    if (!portfolio) {
      return Response.json(
        {
          status: "error",
          message: "Portfolio not found"
        },
        { status: 404 }
      );
    }

    const result = await env.DB
      .prepare(`
        SELECT
          id,
          portfolio_id,
          instrument_key,
          symbol,
          name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
        FROM portfolio_holdings
        WHERE portfolio_id = ?
        AND user_email = ?
        ORDER BY created_at ASC
      `)
      .bind(
        portfolioId,
        session.email
      )
      .all();

    return Response.json({
      status: "success",
      holdings: result.results
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to load holdings"
      },
      { status: 500 }
    );
  }
}


/* =====================================================
   ADD HOLDING
   POST /api/portfolio/holdings
===================================================== */

export async function onRequestPost(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, session } = auth;

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS portfolio_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        instrument_key TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT,
        exchange TEXT,
        quantity REAL NOT NULL,
        avg_price REAL NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(portfolio_id, instrument_key)
      )
    `).run();

    const body = await request.json();

    const portfolioId = Number(
      body.portfolio_id
    );

    const instrumentKey = String(
      body.instrument_key || ""
    ).trim();

    const symbol = String(
      body.symbol || ""
    ).trim();

    const name = String(
      body.name || ""
    ).trim();

    const exchange = String(
      body.exchange || ""
    ).trim();

    const quantity = Number(
      body.quantity
    );

    const avgPrice = Number(
      body.avg_price
    );

    if (
      !Number.isInteger(portfolioId) ||
      portfolioId <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Valid portfolio_id is required"
        },
        { status: 400 }
      );
    }

    if (!instrumentKey) {
      return Response.json(
        {
          status: "error",
          message: "instrument_key is required"
        },
        { status: 400 }
      );
    }

    if (!symbol) {
      return Response.json(
        {
          status: "error",
          message: "Stock symbol is required"
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Quantity must be greater than zero"
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(avgPrice) ||
      avgPrice <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Average price must be greater than zero"
        },
        { status: 400 }
      );
    }

    const portfolio = await env.DB
      .prepare(`
        SELECT id
        FROM portfolios
        WHERE id = ?
        AND user_email = ?
      `)
      .bind(
        portfolioId,
        session.email
      )
      .first();

    if (!portfolio) {
      return Response.json(
        {
          status: "error",
          message: "Portfolio not found"
        },
        { status: 404 }
      );
    }

    const existing = await env.DB
      .prepare(`
        SELECT
          id,
          quantity,
          avg_price
        FROM portfolio_holdings
        WHERE portfolio_id = ?
        AND user_email = ?
        AND instrument_key = ?
      `)
      .bind(
        portfolioId,
        session.email,
        instrumentKey
      )
      .first();

    const now = Date.now();

    if (existing) {

      const oldQuantity =
        Number(existing.quantity);

      const oldAverage =
        Number(existing.avg_price);

      const totalQuantity =
        oldQuantity + quantity;

      const totalCost =
        (oldQuantity * oldAverage) +
        (quantity * avgPrice);

      const newAverage =
        totalCost / totalQuantity;

      const updated = await env.DB
        .prepare(`
          UPDATE portfolio_holdings
          SET
            quantity = ?,
            avg_price = ?,
            symbol = ?,
            name = ?,
            exchange = ?,
            updated_at = ?
          WHERE id = ?
          AND user_email = ?
          RETURNING
            id,
            portfolio_id,
            instrument_key,
            symbol,
            name,
            exchange,
            quantity,
            avg_price,
            created_at,
            updated_at
        `)
        .bind(
          totalQuantity,
          newAverage,
          symbol,
          name,
          exchange,
          now,
          existing.id,
          session.email
        )
        .first();

      return Response.json({
        status: "success",
        action: "updated",
        holding: updated
      });
    }

    const inserted = await env.DB
      .prepare(`
        INSERT INTO portfolio_holdings
        (
          portfolio_id,
          user_email,
          instrument_key,
          symbol,
          name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
          id,
          portfolio_id,
          instrument_key,
          symbol,
          name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
      `)
      .bind(
        portfolioId,
        session.email,
        instrumentKey,
        symbol,
        name,
        exchange,
        quantity,
        avgPrice,
        now,
        now
      )
      .first();

    return Response.json({
      status: "success",
      action: "created",
      holding: inserted
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to add holding"
      },
      { status: 500 }
    );
  }
}


/* =====================================================
   EDIT HOLDING
   PUT /api/portfolio/holdings
===================================================== */

export async function onRequestPut(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, session } = auth;

    const body = await request.json();

    const id = Number(body.id);
    const quantity = Number(body.quantity);
    const avgPrice = Number(body.avg_price);

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Valid holding id is required"
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Quantity must be greater than zero"
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(avgPrice) ||
      avgPrice <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Average price must be greater than zero"
        },
        { status: 400 }
      );
    }

    const result = await env.DB
      .prepare(`
        UPDATE portfolio_holdings
        SET
          quantity = ?,
          avg_price = ?,
          updated_at = ?
        WHERE id = ?
        AND user_email = ?
        RETURNING
          id,
          portfolio_id,
          instrument_key,
          symbol,
          name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
      `)
      .bind(
        quantity,
        avgPrice,
        Date.now(),
        id,
        session.email
      )
      .first();

    if (!result) {
      return Response.json(
        {
          status: "error",
          message: "Holding not found"
        },
        { status: 404 }
      );
    }

    return Response.json({
      status: "success",
      holding: result
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to update holding"
      },
      { status: 500 }
    );
  }
}


/* =====================================================
   DELETE HOLDING
   DELETE /api/portfolio/holdings?id=123
===================================================== */

export async function onRequestDelete(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, session } = auth;

    const url = new URL(request.url);

    const id = Number(
      url.searchParams.get("id")
    );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message: "Valid holding id is required"
        },
        { status: 400 }
      );
    }

    const result = await env.DB
      .prepare(`
        DELETE FROM portfolio_holdings
        WHERE id = ?
        AND user_email = ?
        RETURNING id
      `)
      .bind(
        id,
        session.email
      )
      .first();

    if (!result) {
      return Response.json(
        {
          status: "error",
          message: "Holding not found"
        },
        { status: 404 }
      );
    }

    return Response.json({
      status: "success",
      message: "Holding removed successfully"
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to remove holding"
      },
      { status: 500 }
    );
  }
}
