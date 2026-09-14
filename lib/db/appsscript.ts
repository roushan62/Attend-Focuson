import type { Row, Tab } from "@/lib/types";

/**
 * Google Apps Script driver — the "no Cloud Console" production path.
 *
 * The sheet is exposed through a Web App (google-apps-script/Code.gs) that
 * speaks one tiny protocol:
 *
 *   GET {APPS_SCRIPT_URL}?payload={"secret":...,"action":"list","tab":"Users"}
 *
 * Requests are GET-on-purpose: Apps Script 302-redirects /exec and POST
 * bodies get dropped across redirects, while query strings survive.
 * Secret is shared in the payload; the script refuses anything else.
 * All auth/user-facing security still lives in the Next.js layer.
 */

function base(): string {
  const u = process.env.APPS_SCRIPT_URL;
  if (!u) throw new Error("APPS_SCRIPT_URL missing");
  return u.trim();
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const full = { secret: process.env.APPS_SCRIPT_SECRET ?? "", ...payload };
  const url = `${base()}?payload=${encodeURIComponent(JSON.stringify(full))}`;
  const res = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`Apps Script HTTP ${res.status} — check APPS_SCRIPT_URL / redeploy?`);
  let json: { ok: boolean; data?: T; error?: string };
  try {
    json = await res.json();
  } catch {
    throw new Error("Apps Script ne JSON nahi diya — kya deployment ka access 'Anyone' hai aur Code.gs latest deploy me hai?");
  }
  if (!json.ok) throw new Error(`Apps Script: ${json.error || "unknown error"}`);
  return json.data as T;
}

export async function asList(tab: Tab): Promise<Row[]> {
  return (await call<Row[]>({ action: "list", tab })) ?? [];
}

export async function asInsert(tab: Tab, row: Row): Promise<Row> {
  await call({ action: "insert", tab, row });
  return row;
}

export async function asUpdate(tab: Tab, id: string, patch: Row): Promise<void> {
  await call({ action: "update", tab, id, patch });
}

export async function asRemove(tab: Tab, id: string): Promise<void> {
  await call({ action: "remove", tab, id });
}
