import type { Row, Tab } from "@/lib/types";

/**
 * Storage layer with three drivers (auto-selected):
 *  - "appsscript": Google Sheet + free Apps Script Web App  ← simplest prod
 *  - "sheets":     Google Sheet via service-account REST    ← classic prod
 *  - "local":      JSON file .data/db.json                  ← demo/dev, auto-seeded
 *
 * Priority: APPS_SCRIPT_URL+SECRET present → appsscript. Else
 * GOOGLE_SHEET_ID+client email+key → sheets. Else local demo.
 */

export type Driver = "appsscript" | "sheets" | "local";

export function hasAppsScript(): boolean {
  return !!(process.env.APPS_SCRIPT_URL && process.env.APPS_SCRIPT_SECRET);
}

/** True when the app has ANY real backend configured (not demo mode). */
export function hasGoogleConfig(): boolean {
  return hasAppsScript() || !!(
    process.env.GOOGLE_SHEET_ID &&
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  );
}

export function driverName(): Driver {
  if (hasAppsScript()) return "appsscript";
  if (process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) return "sheets";
  return "local";
}

export function storageLabel(): string {
  switch (driverName()) {
    case "appsscript": return "Google Sheet (Apps Script bridge) ✅";
    case "sheets": return "Google Sheet (Sheets API) ✅";
    default: return "local demo DB (.data/db.json)";
  }
}

/** Serialize mutations (append/update/delete) per process — protects the
 *  sheet from interleaved writes (the Apps Script side also holds LockService). */
let chain: Promise<unknown> = Promise.resolve();
function tx<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function listRaw(tab: Tab): Promise<Row[]> {
  const d = driverName();
  if (d === "appsscript") { const { asList } = await import("./db/appsscript"); return asList(tab); }
  if (d === "sheets") { const { sheetsList } = await import("./db/sheets"); return sheetsList(tab); }
  const { localList } = await import("./db/local"); return localList(tab);
}

export async function list(tab: Tab, pred?: (r: Row) => boolean): Promise<Row[]> {
  const rows = await listRaw(tab);
  return pred ? rows.filter(pred) : rows;
}

export async function findOne(tab: Tab, pred: (r: Row) => boolean): Promise<Row | null> {
  return (await list(tab, pred))[0] ?? null;
}

export async function byId(tab: Tab, id: string): Promise<Row | null> {
  if (!id) return null;
  return findOne(tab, (r) => r.id === id);
}

export async function insert(tab: Tab, data: Row): Promise<Row> {
  return tx(async () => {
    const d = driverName();
    if (d === "appsscript") { const { asInsert } = await import("./db/appsscript"); return asInsert(tab, data); }
    if (d === "sheets") { const { sheetsInsert } = await import("./db/sheets"); return sheetsInsert(tab, data); }
    const { localInsert } = await import("./db/local"); return localInsert(tab, data);
  });
}

export async function update(tab: Tab, id: string, patch: Row): Promise<void> {
  await tx(async () => {
    const d = driverName();
    if (d === "appsscript") { const { asUpdate } = await import("./db/appsscript"); return asUpdate(tab, id, patch); }
    if (d === "sheets") { const { sheetsUpdate } = await import("./db/sheets"); return sheetsUpdate(tab, id, patch); }
    const { localUpdate } = await import("./db/local"); return localUpdate(tab, id, patch);
  });
}

export async function remove(tab: Tab, id: string): Promise<void> {
  await tx(async () => {
    const d = driverName();
    if (d === "appsscript") { const { asRemove } = await import("./db/appsscript"); return asRemove(tab, id); }
    if (d === "sheets") { const { sheetsRemove } = await import("./db/sheets"); return sheetsRemove(tab, id); }
    const { localRemove } = await import("./db/local"); return localRemove(tab, id);
  });
}
