import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import type { Row, Tab } from "@/lib/types";
import { TAB_HEADERS } from "@/lib/types";

/**
 * Google Sheets driver — the sheet IS the database.
 * One tab per table (Companies, Users, Projects, Attendance, Requests),
 * header row = exact column names from TAB_HEADERS.
 *
 * The service account must be shared as Editor on the sheet.
 * See SETUP.md + scripts/create-sheet.mjs (creates the sheet for you).
 */

const g = globalThis as unknown as { __saDoc?: Promise<GoogleSpreadsheet> };

function getDoc(): Promise<GoogleSpreadsheet> {
  if (!g.__saDoc) {
    g.__saDoc = (async () => {
      const auth = new JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL!,
        key: process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, auth);
      await doc.loadInfo();
      return doc;
    })();
    g.__saDoc.catch(() => {
      g.__saDoc = undefined; // allow retry after a transient auth failure
    });
  }
  return g.__saDoc;
}

async function sheet(tab: Tab) {
  const doc = await getDoc();
  const ws = doc.sheetsByTitle[tab];
  if (!ws) {
    throw new Error(
      `Sheet tab "${tab}" not found in GOOGLE_SHEET_ID — create these tabs: ${Object.keys(TAB_HEADERS).join(", ")}`
    );
  }
  await ws.loadHeaderRow();
  return ws;
}

export async function sheetsList(tab: Tab): Promise<Row[]> {
  const ws = await sheet(tab);
  const headers = ws.headerValues.filter(Boolean);
  const rows = await ws.getRows();
  return rows.map((r: any) => {
    const out: Row = {};
    for (const h of headers) out[h] = r[h] == null ? "" : String(r[h]);
    return out;
  });
}

export async function sheetsInsert(tab: Tab, row: Row): Promise<Row> {
  const ws = await sheet(tab);
  const payload: Record<string, string> = {};
  for (const h of ws.headerValues.filter(Boolean)) payload[h] = row[h] ?? "";
  await ws.addRow(payload);
  return row;
}

export async function sheetsUpdate(tab: Tab, id: string, patch: Row): Promise<void> {
  const ws = await sheet(tab);
  const rows = await ws.getRows();
  const r = rows.find((x: any) => String(x.id ?? "") === id);
  if (!r) throw new Error(`${tab} row ${id} not found`);
  for (const [k, v] of Object.entries(patch)) {
    (r as any)[k] = String(v ?? "");
  }
  await (r as any).save();
}

export async function sheetsRemove(tab: Tab, id: string): Promise<void> {
  const ws = await sheet(tab);
  const rows = await ws.getRows();
  const r = rows.find((x: any) => String(x.id ?? "") === id);
  if (!r) return;
  await (r as any).delete();
}
