import fs from "fs";
import path from "path";
import type { Row, Tab } from "@/lib/types";
import { TABS } from "@/lib/types";

/**
 * Zero-dependency local JSON database for demo/development.
 * File: .data/db.json at the repo root. Auto-seeded with a demo company
 * (set SEED_DEMO=0 to skip). Swap to Google Sheets by filling the
 * GOOGLE_* env vars — no code changes needed.
 */

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "db.json");

type Data = Record<Tab, Row[]>;

let cache: Data | null = null;
let initPromise: Promise<Data> | null = null;

async function load(): Promise<Data> {
  if (cache) return cache;
  if (!initPromise) {
    initPromise = (async () => {
      fs.mkdirSync(DIR, { recursive: true });
      if (fs.existsSync(FILE)) {
        const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
        cache = emptyFrom(parsed);
        return cache;
      }
      const fresh = emptyFrom({});
      const { seedDemoData } = await import("@/lib/seed");
      await seedDemoData(fresh);
      fs.writeFileSync(FILE, JSON.stringify(fresh, null, 1));
      cache = fresh;
      return cache;
    })();
  }
  return initPromise;
}

function emptyFrom(src: Partial<Record<Tab, Row[]>>): Data {
  const out = {} as Data;
  for (const t of TABS) out[t] = Array.isArray(src[t]) ? src[t]! : [];
  return out;
}

function persist(data: Data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, FILE);
}

export async function localList(tab: Tab): Promise<Row[]> {
  const d = await load();
  return d[tab].map((r) => ({ ...r }));
}

export async function localInsert(tab: Tab, row: Row): Promise<Row> {
  const d = await load();
  d[tab].push({ ...row });
  persist(d);
  return row;
}

export async function localUpdate(tab: Tab, id: string, patch: Row): Promise<void> {
  const d = await load();
  const i = d[tab].findIndex((r) => r.id === id);
  if (i === -1) throw new Error(`${tab} row ${id} not found`);
  d[tab][i] = { ...d[tab][i], ...patch };
  persist(d);
}

export async function localRemove(tab: Tab, id: string): Promise<void> {
  const d = await load();
  const i = d[tab].findIndex((r) => r.id === id);
  if (i === -1) return;
  d[tab].splice(i, 1);
  persist(d);
}
