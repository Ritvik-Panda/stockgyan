import {
  verifySessionToken,
  SESSION_COOKIE_NAME
} from "../../lib/session.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";");

  for (const part of parts) {
    const trimmed = part.trim();

    if (trimmed.startsWith(name + "=")) {
      return decodeURIComponent(
        trimmed.substring(name.length + 1)
      );
    }
  }

  return null;
}

async function getSessionEmail(request, env) {
  const token = getCookie(
    request,
    SESSION_COOKIE_NAME
  );

  if (!token) {
    return null;
  }

  const session = await verifySessionToken(
    token,
    env.SESSION_SECRET
  );

  if (!session || !session.email) {
    return null;
  }

  return String(session.email).trim().toLowerCase();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    const email = await getSessionEmail(
      request,
      env
    );

    if (!email) {
      return json(
        {
          status: "error",
          message: "Login session expired."
        },
        401
      );
    }

    const row = await env.DB.prepare(
      `SELECT state_json, updated_at
       FROM portfolio_state
       WHERE user_email = ?`
    )
      .bind(email)
      .first();

    if (!row) {
      return json({
        status: "ok",
        exists: false,
        state: null
      });
    }

    let state;

    try {
      state = JSON.parse(row.state_json);
    } catch {
      state = null;
    }

    return json({
      status: "ok",
      exists: !!state,
      state: state,
      updated_at: row.updated_at
    });

  } catch (error) {
    console.error(
      "Portfolio sync GET error:",
      error
    );

    return json(
      {
        status: "error",
        message: "Unable to load portfolio."
      },
      500
    );
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;

  try {
    const email = await getSessionEmail(
      request,
      env
    );

    if (!email) {
      return json(
        {
          status: "error",
          message: "Login session expired."
        },
        401
      );
    }

    const body = await request.json();

    if (
      !body ||
      !Array.isArray(body.portfolios) ||
      typeof body.holdings !== "object" ||
      body.holdings === null ||
      Array.isArray(body.holdings)
    ) {
      return json(
        {
          status: "error",
          message: "Invalid portfolio data."
        },
        400
      );
    }

    const state = {
      portfolios: body.portfolios,
      holdings: body.holdings
    };

    const stateJson = JSON.stringify(state);

    if (stateJson.length > 1000000) {
      return json(
        {
          status: "error",
          message: "Portfolio data is too large."
        },
        400
      );
    }

    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO portfolio_state
       (user_email, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_email)
       DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`
    )
      .bind(
        email,
        stateJson,
        now
      )
      .run();

    return json({
      status: "ok",
      saved: true,
      updated_at: now
    });

  } catch (error) {
    console.error(
      "Portfolio sync PUT error:",
      error
    );

    return json(
      {
        status: "error",
        message: "Unable to save portfolio."
      },
      500
    );
  }
}
