import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { signToken, unsignToken } from "./crypto";
import type { Role, Session } from "./types";

export const SESSION_COOKIE = "af_session";
const MAX_AGE_DAYS = 30;

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export function checkPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash || "");
}

export function normalizePhone(v: string): string {
  return (v || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
}

export async function setSessionCookie(s: Omit<Session, never> & { exp?: number }) {
  const token = signToken({
    ...s,
    exp: Date.now() + MAX_AGE_DAYS * 86400000,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return unsignToken<Session>(raw);
}

/** For server components / layouts — bounces to /login. */
export async function requireSession(roles?: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (roles && !roles.includes(s.role)) redirect("/dashboard");
  return s;
}

/** For API routes — returns null instead of redirecting. */
export async function apiSession(): Promise<Session | null> {
  return getSession();
}

export function isWriteRequest() {
  const h = headers();
  // minimal CSRF guard for cookie-authenticated state changes
  const origin = h.get("origin");
  const host = h.get("host");
  if (!origin || !host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
