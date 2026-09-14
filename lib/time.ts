/**
 * Date / time helpers. Attendance days are decided in the COMPANY timezone
 * (default Asia/Kolkata), never the server's — so an 11:00 AM cutoff means
 * 11:00 AM IST for everyone, wherever Vercel runs the code.
 */
export const DEFAULT_TZ = "Asia/Kolkata";

export function fmtDate(d: Date, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayStr(tz: string = DEFAULT_TZ): string {
  return fmtDate(new Date(), tz);
}

/** Minutes since midnight, local to tz. e.g. "10:42" -> 642 */
export function minutesOfDayInTZ(d: Date = new Date(), tz: string = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const h = get("hour");
  return (h === 24 ? 0 : h) * 60 + get("minute");
}

export function hmToMinutes(hm: string): number {
  const [h, m] = (hm || "11:00").split(":").map((x) => parseInt(x, 10) || 0);
  return h * 60 + m;
}

/** "2026-09-14T10:12:00.000Z" -> "10:12 AM IST" (or any tz) */
export function fmtTimeOf(iso: string, tz: string = DEFAULT_TZ): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(d).replace(/\u202f/g, " ");
}

export function fmtDateHuman(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC", day: "numeric", month: "short", weekday: "short",
  }).format(d);
}

/** All dates in a month, "2026-09" -> ["2026-09-01", ..., "2026-09-30"] */
export function monthDates(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) =>
    `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
  );
}

/** Inclusive list of YYYY-MM-DD between two dates (max 62 days guard) */
export function eachDate(from: string, to: string): string[] {
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse((to || from) + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || end < start) return from ? [from] : [];
  const out: string[] = [];
  for (let t = start; t <= end && out.length < 62; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function currentMonthStr(tz: string = DEFAULT_TZ): string {
  return todayStr(tz).slice(0, 7);
}
