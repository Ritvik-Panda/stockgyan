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

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    if (!env.DB) {
      return Response.json(
        {
          status: "error",
          message: "Database binding DB is not configured"
        },
        { status: 500 }
      );
    }

    if (!env.SESSION_SECRET) {
      return Response.json(
        {
          status: "error",
          message: "SESSION_SECRET is not configured"
        },
        { status: 500 }
      );
    }

    const session = await getSessionEmail(
      request,
      env
    );

    if (!session) {
      return Response.json(
        {
          status: "error",
          message: "Not authenticated"
        },
        { status: 401 }
      );
    }

    const userEmail = session.email;

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
      .bind(userEmail)
      .all();

    /*
      Create a default portfolio for a new client.
    */
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
          userEmail,
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
        .bind(userEmail)
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
    const { request, env } = context;

    if (!env.DB) {
      return Response.json(
        {
          status: "error",
          message: "Database binding DB is not configured"
        },
        { status: 500 }
      );
    }

    if (!env.SESSION_SECRET) {
      return Response.json(
        {
          status: "error",
          message: "SESSION_SECRET is not configured"
        },
        { status: 500 }
      );
    }

    const session = await getSessionEmail(
      request,
      env
    );

    if (!session) {
      return Response.json(
        {
          status: "error",
          message: "Not authenticated"
        },
        { status: 401 }
      );
    }

    const body = await request.json();

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
        session.email,
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
