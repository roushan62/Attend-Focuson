import type { Row } from "@/lib/types";
import { list, byId } from "@/lib/db";
import { statusMeta, type AttStatus } from "@/lib/types";
import { monthDates, todayStr, fmtDate, minutesOfDayInTZ, hmToMinutes } from "@/lib/time";
import { getDistanceInMeters } from "@/lib/distance";

/** All domain queries live here so routes/pages stay thin. */

export async function companyOf(cid: string): Promise<Row> {
  const c = await byId("Companies", cid);
  if (!c) throw new Error("Company not found for this session — re-login.");
  return c;
}

export async function employeesOf(cid: string, activeOnly = true): Promise<Row[]> {
  return list("Users", (u) => u.company_id === cid && (!activeOnly || u.status !== "inactive"));
}

export async function projectsOf(cid: string, activeOnly = true): Promise<Row[]> {
  return list("Projects", (p) => p.company_id === cid && (!activeOnly || p.status !== "inactive"));
}

export async function attendanceFor(cid: string, employeeId: string, dates?: Set<string>): Promise<Row[]> {
  const rows = await list("Attendance", (a) => a.company_id === cid && a.employee_id === employeeId);
  return dates ? rows.filter((a) => dates.has(a.date)) : rows;
}

export async function attendanceOn(cid: string, date: string, employeeId?: string): Promise<Row[]> {
  return list(
    "Attendance",
    (a) => a.company_id === cid && a.date === date && (!employeeId || a.employee_id === employeeId)
  );
}

export interface DayCell {
  date: string;
  status: AttStatus | null;
  checkIn: string;
  checkOut: string;
  distanceIn: string;
  projectId: string;
  remarks: string;
}

export interface EmployeeMonth {
  employee: Row;
  project: Row | null;
  cells: DayCell[];
  present: number; late: number; half: number; onDuty: number; leave: number;
  absent: number; pending: number;
  payable: number; wage: number; amount: number;
}

/**
 * Monthly payroll matrix: every active employee × every day of the month.
 * pay weights come from STATUS_META (present/late/on_duty = 1, half = 0.5).
 */
export async function buildMonthReport(cid: string, month: string): Promise<{
  days: string[]; rows: EmployeeMonth[]; tz: string;
}> {
  const company = await companyOf(cid);
  const tz = company.timezone || "Asia/Kolkata";
  const [users, projects, attAll] = await Promise.all([
    employeesOf(cid),
    projectsOf(cid, false),
    list("Attendance", (a) => a.company_id === cid && a.date.startsWith(month)),
  ]);
  const byDate = new Map<string, Row[]>();
  for (const a of attAll) {
    const key = `${a.employee_id}|${a.date}`;
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(a);
  }
  const projMap = new Map(projects.map((p) => [p.id, p]));
  const days = monthDates(month);
  const today = todayStr(tz);

  const rows: EmployeeMonth[] = [];
  for (const u of users) {
    if (u.role === "admin") continue; // owner usually has no site wage
    const cells: DayCell[] = [];
    let present = 0, late = 0, half = 0, onDuty = 0, leave = 0, absent = 0, pending = 0;
    for (const d of days) {
      if (d > today) { cells.push({ date: d, status: null, checkIn: "", checkOut: "", distanceIn: "", projectId: "", remarks: "" }); continue; }
      const recs = byDate.get(`${u.id}|${d}`);
      const rec = recs ? [...recs].sort((x, y) => y.date.localeCompare(x.date))[0] : null;
      if (!rec) {
        cells.push({ date: d, status: null, checkIn: "", checkOut: "", distanceIn: "", projectId: "", remarks: "" });
        continue;
      }
      const st = (rec.status || "absent") as AttStatus;
      const meta = statusMeta(st);
      if (st === "present") present++;
      else if (st === "late") late++;
      else if (st === "half_day") half++;
      else if (st === "on_duty") onDuty++;
      else if (st === "leave") leave++;
      else if (st === "absent") absent++;
      else if (st.endsWith("_pending")) pending++;
      void meta;
      cells.push({
        date: d, status: st, checkIn: rec.check_in_time, checkOut: rec.check_out_time,
        distanceIn: rec.check_in_distance_m, projectId: rec.project_id, remarks: rec.remarks,
      });
    }
    const payable = present + late + onDuty + half * 0.5;
    const wage = parseFloat(u.daily_wage || "0") || 0;
    rows.push({
      employee: u, project: projMap.get(u.current_project_id) ?? null,
      cells, present, late, half, onDuty, leave, absent, pending,
      payable, wage, amount: Math.round(payable * wage),
    });
  }
  return { days, rows, tz };
}

export function geoDistance(
  p: { lat: number; lng: number }, o: { lat: number; lng: number }
): number {
  return Math.round(getDistanceInMeters(p.lat, p.lng, o.lat, o.lng));
}

export function companyCutoffPassed(company: Row): boolean {
  return minutesOfDayInTZ(new Date(), company.timezone || "Asia/Kolkata") >= hmToMinutes(company.cutoff_time || "11:00");
}

export function fmtDayShort(date: string): string {
  return fmtDate(new Date(date + "T00:00:00Z"), "UTC").slice(8);
}
