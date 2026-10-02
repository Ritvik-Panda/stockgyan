/*
  StockGyan Portfolio API
  Route: /api/portfolio

  GET    /api/portfolio              -> list current user's portfolios
  POST   /api/portfolio              -> create portfolio
  PATCH  /api/portfolio              -> rename portfolio
  DELETE /api/portfolio?id=123       -> delete portfolio + its holdings

  Authentication:
  Uses the same email-OTP session cookie already used by
  /api/portfolio/holdings.
*/

import {
  verifySessionToken,
  SESSION_COOKIE_NAME
} from "../../lib/session.js";


function getSessionEmail(request, env) {

  const cookieHeader =
    request.headers.get("Cookie") || "";

  const cookies =
    cookieHeader
      .split(";")
      .map(function(item) {
        return item.trim();
      });

  const sessionCookie =
    cookies.find(function(item) {
      return item.startsWith(
        `${SESSION_COOKIE_NAME}=`
      );
    });

  if (!sessionCookie) {
    return null;
  }

  const token =
    sessionCookie.substring(
      SESSION_COOKIE_NAME.length + 1
    );

  const verified = await verifySessionToken(
    token,
    env.SESSION_SECRET
  );

  // Support the session format used by the OTP login.
  // Some session implementations return the email directly,
  // while others return an object containing email.
  const email =
    typeof verified === "string"
      ? verified
      : (
          verified &&
          (
            verified.email ||
            (verified.payload && verified.payload.email) ||
            (verified.user && verified.user.email)
          )
        );

  if (!email) {
    return null;
  }

  return {
    email: String(email).trim().toLowerCase()
  };
}


async function authenticate(context) {

  const { request, env } = context;

  if (!env.DB) {
    return {
      error: Response.json(
        {
          status: "error",
          message:
            "Database binding DB is not configured"
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
          message:
            "SESSION_SECRET is not configured"
        },
        { status: 500 }
      )
    };
  }

  const session =
    await getSessionEmail(
      request,
      env
    );

  if (
    !session ||
    !session.email ||
    typeof session.email !== "string"
  ) {
    return {
      error: Response.json(
        {
          status: "error",
          message:
            "Unable to identify the logged-in email. Please login again."
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


/*
  Make sure the existing portfolio table exists.

  IMPORTANT:
  We use the existing schema:
    id
    user_email
    name
    created_at
    updated_at

  We do NOT create a new user_id schema.
*/
async function ensurePortfolioTable(env) {

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

}


/*
  GET /api/portfolio

  Returns ONLY portfolios belonging to
  the authenticated email.
*/
export async function onRequestGet(context) {

  try {

    const auth =
      await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const {
      env,
      session
    } = auth;

    await ensurePortfolioTable(env);

    let result =
      await env.DB.prepare(`
        SELECT
          id,
          user_email,
          name,
          created_at,
          updated_at
        FROM portfolios
        WHERE user_email = ?
        ORDER BY id ASC
      `)
      .bind(session.email)
      .all();

    /*
      New user:
      automatically create My Portfolio.
    */
    if (!result.results.length) {

      const now =
        Date.now();

      const inserted =
        await env.DB.prepare(`
          INSERT INTO portfolios
          (
            user_email,
            name,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?)
          RETURNING
            id,
            user_email,
            name,
            created_at,
            updated_at
        `)
        .bind(
          session.email,
          "My Portfolio",
          now,
          now
        )
        .first();

      result = {
        results: inserted
          ? [inserted]
          : []
      };

    }

    return Response.json({
      status: "success",
      portfolios: result.results
    });

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to load portfolios"
      },
      { status: 500 }
    );

  }

}


/*
  POST /api/portfolio

  Body:
  {
    "name": "Long Term Portfolio"
  }
*/
export async function onRequestPost(context) {

  try {

    const auth =
      await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const {
      request,
      env,
      session
    } = auth;

    await ensurePortfolioTable(env);

    const body =
      await request.json();

    const name =
      String(
        body.name || ""
      )
      .trim()
      .substring(0, 50);

    if (!name) {

      return Response.json(
        {
          status: "error",
          message:
            "Portfolio name is required"
        },
        { status: 400 }
      );

    }

    const now =
      Date.now();

    const portfolio =
      await env.DB.prepare(`
        INSERT INTO portfolios
        (
          user_email,
          name,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?)
        RETURNING
          id,
          user_email,
          name,
          created_at,
          updated_at
      `)
      .bind(
        session.email,
        name,
        now,
        now
      )
      .first();

    return Response.json({
      status: "success",
      portfolio: portfolio
    });

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to create portfolio"
      },
      { status: 500 }
    );

  }

}


/*
  PATCH /api/portfolio

  Body:
  {
    "id": 1,
    "name": "Long Term"
  }
*/
export async function onRequestPatch(context) {

  try {

    const auth =
      await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const {
      request,
      env,
      session
    } = auth;

    await ensurePortfolioTable(env);

    const body =
      await request.json();

    const id =
      Number(body.id);

    const name =
      String(
        body.name || ""
      )
      .trim()
      .substring(0, 50);

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return Response.json(
        {
          status: "error",
          message:
            "Valid portfolio id is required"
        },
        { status: 400 }
      );

    }

    if (!name) {

      return Response.json(
        {
          status: "error",
          message:
            "Portfolio name is required"
        },
        { status: 400 }
      );

    }

    const updated =
      await env.DB.prepare(`
        UPDATE portfolios
        SET
          name = ?,
          updated_at = ?
        WHERE
          id = ?
          AND user_email = ?
        RETURNING
          id,
          user_email,
          name,
          created_at,
          updated_at
      `)
      .bind(
        name,
        Date.now(),
        id,
        session.email
      )
      .first();

    if (!updated) {

      return Response.json(
        {
          status: "error",
          message:
            "Portfolio not found"
        },
        { status: 404 }
      );

    }

    return Response.json({
      status: "success",
      portfolio: updated
    });

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to rename portfolio"
      },
      { status: 500 }
    );

  }

}


/*
  DELETE /api/portfolio?id=123

  Deletes the portfolio and all holdings
  belonging to that portfolio, but ONLY when
  the portfolio belongs to the authenticated user.
*/
export async function onRequestDelete(context) {

  try {

    const auth =
      await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const {
      request,
      env,
      session
    } = auth;

    await ensurePortfolioTable(env);

    const url =
      new URL(request.url);

    const id =
      Number(
        url.searchParams.get("id")
      );

    if (
      !Number.isInteger(id) ||
      id <= 0
    ) {

      return Response.json(
        {
          status: "error",
          message:
            "Valid portfolio id is required"
        },
        { status: 400 }
      );

    }

    const portfolio =
      await env.DB.prepare(`
        SELECT id
        FROM portfolios
        WHERE
          id = ?
          AND user_email = ?
      `)
      .bind(
        id,
        session.email
      )
      .first();

    if (!portfolio) {

      return Response.json(
        {
          status: "error",
          message:
            "Portfolio not found"
        },
        { status: 404 }
      );

    }

    /*
      Delete holdings first because the existing
      database schema may not enforce ON DELETE CASCADE.
    */
    await env.DB.prepare(`
      DELETE FROM portfolio_holdings
      WHERE
        portfolio_id = ?
        AND user_email = ?
    `)
    .bind(
      id,
      session.email
    )
    .run();

    await env.DB.prepare(`
      DELETE FROM portfolios
      WHERE
        id = ?
        AND user_email = ?
    `)
    .bind(
      id,
      session.email
    )
    .run();

    return Response.json({
      status: "success",
      message:
        "Portfolio deleted successfully"
    });

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to delete portfolio"
      },
      { status: 500 }
    );

  }

}
