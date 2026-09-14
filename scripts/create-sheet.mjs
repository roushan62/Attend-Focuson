/**
 * Creates the "AttendanceDB" Google Sheet with all 5 tabs + headers,
 * so you never have to type them by hand.
 *
 *   1. Put GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY in .env.local
 *   2. Run:  node scripts/create-sheet.mjs
 *   3. It prints a new sheet URL → copy the ID into GOOGLE_SHEET_ID.
 *
 * Needs "Google Sheets API" + "Google Drive API" enabled in Cloud Console.
 * The created sheet is owned by the service account, so NO manual sharing
 * is needed. If you made the sheet by hand instead, Share → Editor the
 * service account email and skip this script.
 */
import { JWT } from "google-auth-library";
import { readFileSync, existsSync } from "node:fs";

// tiny .env.local reader (no dotenv dependency)
const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}
const email = process.env.GOOGLE_CLIENT_EMAIL || env.GOOGLE_CLIENT_EMAIL;
const key = (process.env.GOOGLE_PRIVATE_KEY || env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!email || !key) {
  console.error("✗ GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY nahi mile (.env.local me daalo).");
  process.exit(1);
}

const HEADERS = {
  Companies: ["id", "name", "cutoff_time", "default_radius_m", "timezone", "created_at"],
  Users: ["id", "company_id", "name", "phone", "password_hash", "role", "current_project_id", "daily_wage", "status", "created_at"],
  Projects: ["id", "company_id", "name", "address", "latitude", "longitude", "radius_m", "start_date", "end_date", "status"],
  Attendance: ["id", "company_id", "employee_id", "project_id", "date", "check_in_time", "check_in_lat", "check_in_lng", "check_in_distance_m", "check_out_time", "check_out_lat", "check_out_lng", "check_out_distance_m", "status", "remarks", "approved_by"],
  Requests: ["id", "company_id", "employee_id", "type", "reason", "from_date", "to_date", "project_id", "attendance_id", "status", "review_note", "reviewed_by", "reviewed_at", "created_at"],
};

const auth = new JWT({
  email,
  key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});
const access_token = await auth.getAccessToken();
const H = { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` };

const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    properties: { title: "AttendanceDB" },
    sheets: Object.keys(HEADERS).map((title) => ({ properties: { title } })),
  }),
});
if (!res.ok) {
  const t = await res.text();
  console.error("✗ Sheet create fail:", t.slice(0, 600));
  console.error("  → Check: Sheets API + Drive API enabled? Key sahi hai?");
  process.exit(1);
}
const created = await res.json();

const values = Object.entries(HEADERS).map(([tab, hdrs]) => ({
  range: `${tab}!A1`,
  values: [hdrs],
}));
const put = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values:batchUpdate?valueInputOption=RAW`,
  { method: "POST", headers: H, body: JSON.stringify({ data: values }) }
);
if (!put.ok) console.warn("⚠ header write failed:", (await put.text()).slice(0, 400));

console.log("\n✅ Sheet ban gayi:");
console.log("   https://docs.google.com/spreadsheets/d/" + created.spreadsheetId + "/edit");
console.log("\nAb .env.local me ye line add/update karo:");
console.log("GOOGLE_SHEET_ID=" + created.spreadsheetId);
