export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    // --------------------------------------------------
    // 1. Check required secrets / database
    // --------------------------------------------------
    if (!env.RESEND_API_KEY) {
      return Response.json(
        {
          status: "error",
          message: "RESEND_API_KEY is not configured"
        },
        { status: 500 }
      );
    }

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
    // 2. Read email
    // --------------------------------------------------
    const body = await request.json();
    const email = String(body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return Response.json(
        {
          status: "error",
          message: "Email address is required"
        },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return Response.json(
        {
          status: "error",
          message: "Please enter a valid email address"
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 3. Create OTP table if it doesn't exist
    // --------------------------------------------------
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `).run();

    // --------------------------------------------------
    // 4. Delete old OTPs for this email
    // --------------------------------------------------
    await env.DB
      .prepare(`
        DELETE FROM otp_codes
        WHERE email = ?
      `)
      .bind(email)
      .run();

    // --------------------------------------------------
    // 5. Generate secure 6-digit OTP
    // --------------------------------------------------
    const randomArray = new Uint32Array(1);

    crypto.getRandomValues(randomArray);

    const otp =
      String(randomArray[0] % 1000000)
        .padStart(6, "0");

    // --------------------------------------------------
    // 6. Hash OTP before storing
    // --------------------------------------------------
    const encoder = new TextEncoder();

    const hashBuffer =
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(otp)
      );

    const hashArray =
      Array.from(new Uint8Array(hashBuffer));

    const otpHash =
      hashArray
        .map(byte =>
          byte.toString(16).padStart(2, "0")
        )
        .join("");

    // OTP valid for 10 minutes
    const now = Date.now();

    const expiresAt =
      now + (10 * 60 * 1000);

    // --------------------------------------------------
    // 7. Store OTP hash
    // --------------------------------------------------
    await env.DB
      .prepare(`
        INSERT INTO otp_codes
        (
          email,
          otp_hash,
          expires_at,
          attempts,
          used,
          created_at
        )
        VALUES (?, ?, ?, 0, 0, ?)
      `)
      .bind(
        email,
        otpHash,
        expiresAt,
        now
      )
      .run();

    // --------------------------------------------------
    // 8. Send OTP using Resend
    // --------------------------------------------------
    const resendResponse =
      await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${env.RESEND_API_KEY}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            from:
              "StockGyan <noreply@stockgyan.in>",

            to: [email],

            subject:
              "Your StockGyan Login OTP",

            html: `
              <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: auto;
                padding: 30px;
                background: #f7f9fc;
              ">

                <div style="
                  background: white;
                  padding: 30px;
                  border-radius: 12px;
                  border: 1px solid #e5e7eb;
                ">

                  <h2 style="
                    color: #082a63;
                    margin-top: 0;
                  ">
                    StockGyan Login
                  </h2>

                  <p>
                    Your One-Time Password (OTP) is:
                  </p>

                  <div style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    color: #159447;
                    margin: 25px 0;
                  ">
                    ${otp}
                  </div>

                  <p>
                    This OTP is valid for
                    <strong>10 minutes</strong>.
                  </p>

                  <p style="
                    color: #666;
                    font-size: 13px;
                  ">
                    If you did not request this OTP,
                    you can safely ignore this email.
                  </p>

                  <hr style="
                    border: 0;
                    border-top: 1px solid #eee;
                    margin: 25px 0;
                  ">

                  <p style="
                    color: #888;
                    font-size: 12px;
                  ">
                    StockGyan<br>
                    stockgyan.in
                  </p>

                </div>
              </div>
            `
          })
        }
      );

    const resendData =
      await resendResponse.json();

    // --------------------------------------------------
    // 9. Handle Resend error
    // --------------------------------------------------
    if (!resendResponse.ok) {
      console.error(
        "Resend error:",
        resendData
      );

      return Response.json(
        {
          status: "error",
          message:
            "Unable to send OTP email"
        },
        { status: 502 }
      );
    }

    // --------------------------------------------------
    // 10. Success
    // --------------------------------------------------
    return Response.json({
      status: "success",
      message:
        "OTP sent successfully",
      email: email
    });

  } catch (error) {

    console.error(
      "Send OTP error:",
      error
    );

    return Response.json(
      {
        status: "error",
        message:
          "Unable to send OTP"
      },
      { status: 500 }
    );
  }
}
