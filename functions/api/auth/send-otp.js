export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.RESEND_API_KEY) return Response.json({status:"error",message:"RESEND_API_KEY is not configured"},{status:500});
    if (!env.DB) return Response.json({status:"error",message:"Database binding DB is not configured"},{status:500});
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const mobile = String(body.mobile || "").replace(/\D/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({status:"error",message:"Please enter a valid email address"},{status:400});
    if ((name && !mobile) || (!name && mobile)) return Response.json({status:"error",message:"For registration, provide both name and mobile number"},{status:400});
    if (name && name.length < 2) return Response.json({status:"error",message:"Please enter your full name"},{status:400});
    if (name && !/^[6-9]\d{9}$/.test(mobile)) return Response.json({status:"error",message:"Please enter a valid 10-digit Indian mobile number"},{status:400});

    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL,otp_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,customer_name TEXT,mobile TEXT)`).run();
    // Safe additive migration for existing installations.
    try { await env.DB.prepare(`ALTER TABLE otp_codes ADD COLUMN customer_name TEXT`).run(); } catch (_) {}
    try { await env.DB.prepare(`ALTER TABLE otp_codes ADD COLUMN mobile TEXT`).run(); } catch (_) {}
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_profiles (email TEXT PRIMARY KEY, full_name TEXT NOT NULL, mobile TEXT NOT NULL, mobile_verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`).run();
    await env.DB.prepare(`DELETE FROM otp_codes WHERE email = ?`).bind(email).run();
    const randomArray = new Uint32Array(1); crypto.getRandomValues(randomArray);
    const otp = String(randomArray[0] % 1000000).padStart(6,"0");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(otp));
    const otpHash = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
    const now = Date.now(), expiresAt = now + 10*60*1000;
    await env.DB.prepare(`INSERT INTO otp_codes (email,otp_hash,expires_at,attempts,used,created_at,customer_name,mobile) VALUES (?,?,?,0,0,?,?,?)`).bind(email,otpHash,expiresAt,now,name || null,mobile || null).run();
    const resendResponse = await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:"StockGyan <noreply@stockgyan.in>",to:[email],subject:"Your StockGyan Login OTP",html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px;background:#f7f9fc"><div style="background:#fff;padding:30px;border-radius:12px;border:1px solid #e5e7eb"><h2 style="color:#082a63;margin-top:0">StockGyan Login</h2><p>Your One-Time Password (OTP) is:</p><div style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#159447;margin:25px 0">${otp}</div><p>This OTP is valid for <strong>10 minutes</strong>.</p><p style="color:#666;font-size:13px">If you did not request this OTP, you can safely ignore this email.</p><hr style="border:0;border-top:1px solid #eee;margin:25px 0"><p style="color:#888;font-size:12px">StockGyan<br>stockgyan.in</p></div></div>`})});
    const resendData = await resendResponse.json();
    if (!resendResponse.ok) { console.error("Resend error:",resendData); return Response.json({status:"error",message:"Unable to send OTP email"},{status:502}); }
    return Response.json({status:"success",message:"OTP sent successfully",email});
  } catch (error) { console.error("Send OTP error:",error); return Response.json({status:"error",message:"Unable to send OTP"},{status:500}); }
}
