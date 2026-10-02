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

  if (!session || !session.email) {
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
    email: session.email
  };
}

async function ensurePortfolioTable(env) {
  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    .run();
}

export async function onRequestGet(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { env, email } = auth;

    await ensurePortfolioTable(env);

    let result = await env.DB
      .prepare(`
        SELECT
          id,
          name,
          created_at,
          updated_at
        FROM portfolios
        WHERE user_email = ?
        ORDER BY created_at ASC
      `)
      .bind(email)
      .all();

    if (!result.results.length) {
      const now = Date.now();

      await env.DB
        .prepare(`
          INSERT INTO portfolios
          (
            user_email,
            name,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?)
        `)
        .bind(
          email,
          "My Portfolio",
          now,
          now
        )
        .run();

      result = await env.DB
        .prepare(`
          SELECT
            id,
            name,
            created_at,
            updated_at
          FROM portfolios
          WHERE user_email = ?
          ORDER BY created_at ASC
        `)
        .bind(email)
        .all();
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

export async function onRequestPost(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, email } = context;
    const body = await request.json();

    await ensurePortfolioTable(env);

    const name = String(
      body.name || ""
    ).trim();

    if (!name) {
      return Response.json(
        {
          status: "error",
          message: "Portfolio name is required"
        },
        { status: 400 }
      );
    }

    if (name.length > 100) {
      return Response.json(
        {
          status: "error",
          message:
            "Portfolio name must be 100 characters or less"
        },
        { status: 400 }
      );
    }

    const now = Date.now();

    const result = await env.DB
      .prepare(`
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
          name,
          created_at,
          updated_at
      `)
      .bind(
        email,
        name,
        now,
        now
      )
      .first();

    return Response.json({
      status: "success",
      portfolio: result
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

export async function onRequestPatch(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, email } = auth;

    await ensurePortfolioTable(env);

    const body = await request.json();

    const id = Number(body.id);
    const name = String(
      body.name || ""
    ).trim();

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        {
          status: "error",
          message: "Valid portfolio id is required"
        },
        { status: 400 }
      );
    }

    if (!name) {
      return Response.json(
        {
          status: "error",
          message: "Portfolio name is required"
        },
        { status: 400 }
      );
    }

    if (name.length > 100) {
      return Response.json(
        {
          status: "error",
          message:
            "Portfolio name must be 100 characters or less"
        },
        { status: 400 }
      );
    }

    const result = await env.DB
      .prepare(`
        UPDATE portfolios
        SET
          name = ?,
          updated_at = ?
        WHERE
          id = ?
          AND user_email = ?
        RETURNING
          id,
          name,
          created_at,
          updated_at
      `)
      .bind(
        name,
        Date.now(),
        id,
        email
      )
      .first();

    if (!result) {
      return Response.json(
        {
          status: "error",
          message: "Portfolio not found"
        },
        { status: 404 }
      );
    }

    return Response.json({
      status: "success",
      portfolio: result
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

export async function onRequestDelete(context) {
  try {
    const auth = await authenticate(context);

    if (auth.error) {
      return auth.error;
    }

    const { request, env, email } = auth;

    await ensurePortfolioTable(env);

    const url = new URL(request.url);
    const id = Number(
      url.searchParams.get("id")
    );

    if (!Number.isInteger(id) || id <= 0) {
      return Response.json(
        {
          status: "error",
          message: "Valid portfolio id is required"
        },
        { status: 400 }
      );
    }

    const portfolio = await env.DB
      .prepare(`
        SELECT id
        FROM portfolios
        WHERE id = ? AND user_email = ?
      `)
      .bind(id, email)
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

    try {
      await env.DB
        .prepare(`
          DELETE FROM portfolio_holdings
          WHERE portfolio_id = ?
          AND user_email = ?
        `)
        .bind(id, email)
        .run();
    } catch (error) {
      /*
        portfolio_holdings may not exist yet on a brand-new
        deployment. The portfolio itself can still be deleted.
      */
    }

    await env.DB
      .prepare(`
        DELETE FROM portfolios
        WHERE id = ? AND user_email = ?
      `)
      .bind(id, email)
      .run();

    return Response.json({
      status: "success",
      message: "Portfolio deleted"
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
