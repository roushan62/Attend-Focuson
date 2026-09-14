import type { Row, Tab } from "@/lib/types";

/**
 * Storage layer with two drivers:
 *  - "sheets": Google Sheets (AttendanceDB) — production, free
 *  - "local":  JSON file .data/db.json — demo/development, auto-seeded
 * The driver is chosen automatically: if GOOGLE_SHEET_ID + service account
 * env vars exist, we use the sheet; otherwise the local demo database.
 */

export function hasGoogleConfig(): boolean {
  return !!(
    process.env.GOOGLE_SHEET_ID &&
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  );
}

export function driverName(): "sheets" | "local" {
  return hasGoogleConfig() ? "sheets" : "local";
}

/** Serialize mutations (append/update/delete) per process — protects both
 *  the local file and Google Sheets from interleaved writes. */
let chain: Promise<unknown> = Promise.resolve();
function tx<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export async function list(tab: Tab, pred?: (r: Row) => boolean): Promise<Row[]> {
  const rows = await (hasGoogleConfig() ? sheetsRows(tab) : localRows(tab));
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
  return tx(async () =>
    hasGoogleConfig() ? sheetsInsert(tab, data) : localInsert(tab, data)
  );
}

export async function update(tab: Tab, id: string, patch: Row): Promise<void> {
  await tx(async () =>
    hasGoogleConfig() ? sheetsUpdate(tab, id, patch) : localUpdate(tab, id, patch)
  );
}

export async function remove(tab: Tab, id: string): Promise<void> {
  await tx(async () =>
    hasGoogleConfig() ? sheetsRemove(tab, id) : localRemove(tab, id)
  );
}

/* ---------------- local driver ---------------- */

async function localRows(tab: Tab): Promise<Row[]> {
  const { localList } = await import("./db/local");
  return localList(tab);
}
async function localInsert(tab: Tab, data: Row) {
  const { localInsert: f } = await import("./db/local");
  return f(tab, data);
}
async function localUpdate(tab: Tab, id: string, patch: Row) {
  const { localUpdate: f } = await import("./db/local");
  return f(tab, id, patch);
}
async function localRemove(tab: Tab, id: string) {
  const { localRemove: f } = await import("./db/local");
  return f(tab, id);
}

/* ---------------- google sheets driver ---------------- */

async function sheetsRows(tab: Tab): Promise<Row[]> {
  const { sheetsList } = await import("./db/sheets");
  return sheetsList(tab);
}
async function sheetsInsert(tab: Tab, data: Row) {
  const { sheetsInsert: f } = await import("./db/sheets");
  return f(tab, data);
}
async function sheetsUpdate(tab: Tab, id: string, patch: Row) {
  const { sheetsUpdate: f } = await import("./db/sheets");
  return f(tab, id, patch);
}
async function sheetsRemove(tab: Tab, id: string) {
  const { sheetsRemove: f } = await import("./db/sheets");
  return f(tab, id);
}
