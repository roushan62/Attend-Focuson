import crypto from "crypto";

/**
 * Lightweight signed-cookie sessions — no NextAuth, no DB table, no expiry
 * service. Token = base64url(json) + "." + HMAC-SHA256 signature.
 */
const secret = () =>
  process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16
    ? process.env.AUTH_SECRET
    : "siteattend-dev-secret-change-me-in-production";

export function signToken(obj: object): string {
  const p = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function unsignToken<T = any>(token: string): T | null {
  try {
    const [p, sig] = token.split(".");
    if (!p || !sig) return null;
    const expect = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(p, "base64url").toString());
    if (data.exp && Date.now() > data.exp) return null;
    return data as T;
  } catch {
    return null;
  }
}
