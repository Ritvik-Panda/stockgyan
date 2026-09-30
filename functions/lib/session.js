const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function base64urlEncode(value) {
  return btoa(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(value) {
  value = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  while (value.length % 4) {
    value += "=";
  }

  return atob(value);
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(
  email,
  secret
) {
  const payload = {
    email,
    exp:
      Math.floor(Date.now() / 1000) +
      SESSION_MAX_AGE
  };

  const payloadText =
    JSON.stringify(payload);

  const payloadEncoded =
    base64urlEncode(payloadText);

  const key =
    await getKey(secret);

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        payloadEncoded
      )
    );

  const signatureBytes =
    new Uint8Array(signature);

  let binary = "";

  for (const byte of signatureBytes) {
    binary += String.fromCharCode(byte);
  }

  const signatureEncoded =
    base64urlEncode(binary);

  return (
    payloadEncoded +
    "." +
    signatureEncoded
  );
}

export async function verifySessionToken(
  token,
  secret
) {
  try {
    if (!token || !secret) {
      return null;
    }

    const parts =
      token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [
      payloadEncoded,
      signatureEncoded
    ] = parts;

    const key =
      await getKey(secret);

    const signatureBinary =
      base64urlDecode(
        signatureEncoded
      );

    const signatureBytes =
      Uint8Array.from(
        signatureBinary,
        character =>
          character.charCodeAt(0)
      );

    const valid =
      await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        new TextEncoder().encode(
          payloadEncoded
        )
      );

    if (!valid) {
      return null;
    }

    const payload =
      JSON.parse(
        base64urlDecode(
          payloadEncoded
        )
      );

    if (
      !payload.email ||
      !payload.exp
    ) {
      return null;
    }

    if (
      Math.floor(
        Date.now() / 1000
      ) > payload.exp
    ) {
      return null;
    }

    return {
      email: payload.email
    };

  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME =
  "stockgyan_session";
