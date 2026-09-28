export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // --------------------------------------------------
    // 1. Check database
    // --------------------------------------------------

    if (!env.DB) {
      return Response.json(
        {
          status: "error",
          message: "Database binding DB is not configured"
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 2. Read request
    // --------------------------------------------------

    const body = await request.json();

    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    const otp = String(body.otp || "").trim();

    if (!email) {
      return Response.json(
        {
          status: "error",
          message: "Email address is required"
        },
        { status: 400 }
      );
    }

    if (!otp) {
      return Response.json(
        {
          status: "error",
          message: "OTP is required"
        },
        { status: 400 }
      );
    }

    if (!/^\d{6}$/.test(otp)) {
      return Response.json(
        {
          status: "error",
          message: "OTP must be 6 digits"
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 3. Find latest OTP for this email
    // --------------------------------------------------

    const result = await env.DB
      .prepare(`
        SELECT
          id,
          email,
          otp_hash,
          expires_at,
          attempts,
          used
        FROM otp_codes
        WHERE email = ?
        ORDER BY id DESC
        LIMIT 1
      `)
      .bind(email)
      .first();

    if (!result) {
      return Response.json(
        {
          status: "error",
          message: "No OTP found. Please request a new OTP."
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 4. Check if OTP was already used
    // --------------------------------------------------

    if (Number(result.used) === 1) {
      return Response.json(
        {
          status: "error",
          message: "This OTP has already been used. Please request a new OTP."
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 5. Check maximum attempts
    // --------------------------------------------------

    const attempts = Number(result.attempts || 0);

    if (attempts >= 5) {
      return Response.json(
        {
          status: "error",
          message: "Too many incorrect attempts. Please request a new OTP."
        },
        { status: 429 }
      );
    }

    // --------------------------------------------------
    // 6. Check expiry
    // --------------------------------------------------

    const now = Date.now();

    if (now > Number(result.expires_at)) {
      await env.DB
        .prepare(`
          UPDATE otp_codes
          SET used = 1
          WHERE id = ?
        `)
        .bind(result.id)
        .run();

      return Response.json(
        {
          status: "error",
          message: "OTP has expired. Please request a new OTP."
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 7. Hash entered OTP using same SHA-256 method
    //    used by send-otp.js
    // --------------------------------------------------

    const encoder = new TextEncoder();

    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(otp)
    );

    const hashArray = Array.from(
      new Uint8Array(hashBuffer)
    );

    const enteredOtpHash = hashArray
      .map(byte =>
        byte.toString(16).padStart(2, "0")
      )
      .join("");

    // --------------------------------------------------
    // 8. Compare OTP hash
    // --------------------------------------------------

    if (enteredOtpHash !== result.otp_hash) {

      const newAttempts = attempts + 1;

      await env.DB
        .prepare(`
          UPDATE otp_codes
          SET attempts = ?
          WHERE id = ?
        `)
        .bind(newAttempts, result.id)
        .run();

      return Response.json(
        {
          status: "error",
          message: "Incorrect OTP",
          attempts_remaining: Math.max(
            0,
            5 - newAttempts
          )
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 9. OTP is correct
    // --------------------------------------------------

    await env.DB
      .prepare(`
        UPDATE otp_codes
        SET used = 1
        WHERE id = ?
      `)
      .bind(result.id)
      .run();

    // --------------------------------------------------
    // 10. Success
    // --------------------------------------------------

    return Response.json(
      {
        status: "success",
        message: "OTP verified successfully",
        email: email
      },
      { status: 200 }
    );

  } catch (error) {

    return Response.json(
      {
        status: "error",
        message:
          error.message ||
          "Unable to verify OTP"
      },
      { status: 500 }
    );
  }
}
