import {
  createSessionToken,
  SESSION_COOKIE_NAME
} from "../../lib/session.js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.DB) {
      return Response.json({ status: "error", message: "Database binding DB is not configured" }, { status: 500 });
    }
    if (!env.SESSION_SECRET) {
      return Response.json({ status: "error", message: "SESSION_SECRET is not configured" }, { status: 500 });
    }

    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const otp = String(body.otp || "").trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ status: "error", message: "Please enter a valid email address" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(otp)) {
      return Response.json({ status: "error", message: "OTP must be 6 digits" }, { status: 400 });
    }

    const result = await env.DB.prepare(`
      SELECT id, email, otp_hash, expires_at, attempts, used
      FROM otp_codes
      WHERE email = ?
      ORDER BY id DESC
      LIMIT 1
    `).bind(email).first();

    if (!result) {
      return Response.json({ status: "error", message: "No OTP found. Please request a new OTP." }, { status: 404 });
    }
    if (Number(result.used) === 1) {
      return Response.json({ status: "error", message: "This OTP has already been used. Please request a new OTP." }, { status: 400 });
    }

    const attempts = Number(result.attempts || 0);
    if (attempts >= 5) {
      return Response.json({ status: "error", message: "Too many incorrect attempts. Please request a new OTP." }, { status: 429 });
    }

    if (Date.now() > Number(result.expires_at)) {
      await env.DB.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(result.id).run();
      return Response.json({ status: "error", message: "OTP has expired. Please request a new OTP." }, { status: 400 });
    }

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
    const enteredOtpHash = Array.from(new Uint8Array(hashBuffer))
      .map(byte => byte.toString(16).padStart(2, "0")).join("");

    if (enteredOtpHash !== result.otp_hash) {
      const newAttempts = attempts + 1;
      await env.DB.prepare(`UPDATE otp_codes SET attempts = ? WHERE id = ?`).bind(newAttempts, result.id).run();
      return Response.json({
        status: "error",
        message: "Incorrect OTP",
        attempts_remaining: Math.max(0, 5 - newAttempts)
      }, { status: 400 });
    }

    // Mark OTP used before issuing the session.
    await env.DB.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(result.id).run();

    // Create customer profile table if needed. Existing portfolio tables are not modified.
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS customer_profiles (
        email TEXT PRIMARY KEY,
        full_name TEXT,
        mobile TEXT,
        mobile_verified INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `).run();

    // Only create/update a customer profile when registration details were supplied before OTP was sent.
    const pending = await env.DB.prepare(`
      SELECT full_name, mobile
      FROM pending_customer_details
      WHERE email = ?
      LIMIT 1
    `).bind(email).first();

    const now = Date.now();
    if (pending && pending.full_name && pending.mobile) {
      await env.DB.prepare(`
        INSERT INTO customer_profiles (email, full_name, mobile, mobile_verified, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          full_name = excluded.full_name,
          mobile = excluded.mobile,
          updated_at = excluded.updated_at
      `).bind(email, pending.full_name, pending.mobile, now, now).run();

      await env.DB.prepare(`DELETE FROM pending_customer_details WHERE email = ?`).bind(email).run();
    }

    const sessionToken = await createSessionToken(email, env.SESSION_SECRET);

    return new Response(JSON.stringify({
      status: "success",
      message: "OTP verified successfully"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `${SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
      }
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return Response.json({
      status: "error",
      message: "Unable to verify OTP"
    }, { status: 500 });
  }
}
