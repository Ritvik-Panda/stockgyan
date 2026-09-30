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

async function authenticate(request, env) {
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
    email: session.email
  };
}


/*
--------------------------------------------------
GET HOLDINGS
/api/portfolio/holdings?portfolio_id=1
--------------------------------------------------
*/

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const auth = await authenticate(
      request,
      env
    );

    if (auth.error) {
      return auth.error;
    }

    const userEmail = auth.email;

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

    /*
      Make sure this portfolio belongs
      to the logged-in user.
    */
    const portfolio = await env.DB
      .prepare(`
        SELECT id, name
        FROM portfolios
        WHERE id = ?
        AND user_email = ?
        LIMIT 1
      `)
      .bind(
        portfolioId,
        userEmail
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
          company_name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
        FROM portfolio_holdings
        WHERE portfolio_id = ?
        AND user_email = ?
        ORDER BY symbol ASC
      `)
      .bind(
        portfolioId,
        userEmail
      )
      .all();

    return Response.json({
      status: "success",
      portfolio,
      holdings: result.results || []
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to load portfolio holdings"
      },
      { status: 500 }
    );
  }
}


/*
--------------------------------------------------
POST HOLDING
/api/portfolio/holdings
--------------------------------------------------
*/

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const auth = await authenticate(
      request,
      env
    );

    if (auth.error) {
      return auth.error;
    }

    const userEmail = auth.email;

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

    const companyName = String(
      body.company_name || ""
    ).trim();

    const exchange = String(
      body.exchange || "NSE"
    ).trim();

    const quantity = Number(
      body.quantity
    );

    const avgPrice = Number(
      body.avg_price
    );


    /*
      Validate portfolio
    */
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


    /*
      Validate stock
    */
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
          message: "symbol is required"
        },
        { status: 400 }
      );
    }


    /*
      Validate quantity
    */
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


    /*
      Validate average price
    */
    if (
      !Number.isFinite(avgPrice) ||
      avgPrice <= 0
    ) {
      return Response.json(
        {
          status: "error",
          message:
            "Average price must be greater than zero"
        },
        { status: 400 }
      );
    }


    /*
      Make sure portfolio belongs
      to logged-in user.
    */
    const portfolio = await env.DB
      .prepare(`
        SELECT id, name
        FROM portfolios
        WHERE id = ?
        AND user_email = ?
        LIMIT 1
      `)
      .bind(
        portfolioId,
        userEmail
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


    /*
      Check whether this stock already
      exists in the portfolio.
    */
    const existing = await env.DB
      .prepare(`
        SELECT
          id,
          quantity,
          avg_price
        FROM portfolio_holdings
        WHERE portfolio_id = ?
        AND instrument_key = ?
        AND user_email = ?
        LIMIT 1
      `)
      .bind(
        portfolioId,
        instrumentKey,
        userEmail
      )
      .first();


    /*
      If stock already exists,
      combine quantities and calculate
      weighted average price.
    */
    if (existing) {

      const oldQuantity =
        Number(existing.quantity);

      const oldAvgPrice =
        Number(existing.avg_price);

      const newQuantity =
        oldQuantity + quantity;

      const newAvgPrice =
        (
          (oldQuantity * oldAvgPrice) +
          (quantity * avgPrice)
        ) / newQuantity;

      const now = Date.now();

      const updated = await env.DB
        .prepare(`
          UPDATE portfolio_holdings
          SET
            quantity = ?,
            avg_price = ?,
            company_name = ?,
            exchange = ?,
            updated_at = ?
          WHERE id = ?
          AND portfolio_id = ?
          AND user_email = ?
          RETURNING
            id,
            portfolio_id,
            instrument_key,
            symbol,
            company_name,
            exchange,
            quantity,
            avg_price,
            created_at,
            updated_at
        `)
        .bind(
          newQuantity,
          newAvgPrice,
          companyName,
          exchange,
          now,
          existing.id,
          portfolioId,
          userEmail
        )
        .first();

      return Response.json({
        status: "success",
        message: "Holding updated successfully",
        holding: updated
      });
    }


    /*
      New holding
    */
    const now = Date.now();

    const result = await env.DB
      .prepare(`
        INSERT INTO portfolio_holdings
        (
          portfolio_id,
          user_email,
          instrument_key,
          symbol,
          company_name,
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
          company_name,
          exchange,
          quantity,
          avg_price,
          created_at,
          updated_at
      `)
      .bind(
        portfolioId,
        userEmail,
        instrumentKey,
        symbol,
        companyName,
        exchange,
        quantity,
        avgPrice,
        now,
        now
      )
      .first();

    return Response.json({
      status: "success",
      message: "Holding added successfully",
      holding: result
    });

  } catch (error) {
    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to save portfolio holding"
      },
      { status: 500 }
    );
  }
}
