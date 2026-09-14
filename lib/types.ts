export type Role = "admin" | "hr" | "employee";
export type Tab = "Companies" | "Users" | "Projects" | "Attendance" | "Requests";
export type Row = Record<string, string>;

/**
 * Column order for every tab. These EXACT names/order are the contract
 * between the app and the Google Sheet — never change them once live.
 */
export const TAB_HEADERS: Record<Tab, string[]> = {
  Companies: ["id", "name", "cutoff_time", "default_radius_m", "timezone", "created_at"],
  Users: [
    "id", "company_id", "name", "phone", "password_hash", "role",
    "current_project_id", "daily_wage", "status", "created_at",
  ],
  Projects: [
    "id", "company_id", "name", "address", "latitude", "longitude",
    "radius_m", "start_date", "end_date", "status",
  ],
  Attendance: [
    "id", "company_id", "employee_id", "project_id", "date",
    "check_in_time", "check_in_lat", "check_in_lng", "check_in_distance_m",
    "check_out_time", "check_out_lat", "check_out_lng", "check_out_distance_m",
    "status", "remarks", "approved_by",
  ],
  Requests: [
    "id", "company_id", "employee_id", "type", "reason", "from_date", "to_date",
    "project_id", "attendance_id", "status", "review_note", "reviewed_by",
    "reviewed_at", "created_at",
  ],
};

export const TABS: Tab[] = ["Companies", "Users", "Projects", "Attendance", "Requests"];

export type AttStatus =
  | "present"
  | "late"
  | "half_day"
  | "on_duty"
  | "leave"
  | "absent"
  | "late_pending"
  | "outside_pending"
  | "visit_pending";

export interface StatusMeta {
  label: string;
  short: string;
  cls: string; // tailwind chip classes
  pay: number; // salary weight (1 = full paid day)
}

export const STATUS_META: Record<AttStatus, StatusMeta> = {
  present: { label: "Present", short: "P", cls: "bg-emerald-100 text-emerald-800 border-emerald-200", pay: 1 },
  late: { label: "Late (approved)", short: "L", cls: "bg-amber-100 text-amber-800 border-amber-200", pay: 1 },
  half_day: { label: "Half day", short: "H", cls: "bg-sky-100 text-sky-800 border-sky-200", pay: 0.5 },
  on_duty: { label: "On duty / travel", short: "O", cls: "bg-indigo-100 text-indigo-800 border-indigo-200", pay: 1 },
  leave: { label: "Leave (unpaid)", short: "V", cls: "bg-slate-100 text-slate-600 border-slate-200", pay: 0 },
  absent: { label: "Absent", short: "A", cls: "bg-rose-100 text-rose-800 border-rose-200", pay: 0 },
  late_pending: { label: "Late — waiting approval", short: "LP", cls: "bg-orange-100 text-orange-800 border-orange-200", pay: 0 },
  outside_pending: { label: "Outside site — waiting approval", short: "OP", cls: "bg-orange-100 text-orange-800 border-orange-200", pay: 0 },
  visit_pending: { label: "Site visit — waiting approval", short: "VP", cls: "bg-orange-100 text-orange-800 border-orange-200", pay: 0 },
};

export function statusMeta(s: string): StatusMeta {
  return STATUS_META[(s || "absent") as AttStatus] ?? {
    label: s, short: (s || "?").slice(0, 2).toUpperCase(),
    cls: "bg-slate-100 text-slate-600 border-slate-200", pay: 0,
  };
}

export type ReqType = "late" | "out_of_radius" | "site_visit" | "leave" | "half_day" | "on_duty";

export const REQ_META: Record<ReqType, { label: string }> = {
  late: { label: "Late check-in approval" },
  out_of_radius: { label: "Outside site — approval" },
  site_visit: { label: "Site visit attendance" },
  leave: { label: "Leave" },
  half_day: { label: "Half day" },
  on_duty: { label: "On duty / travel (paid)" },
};

export interface Session {
  uid: string;
  role: Role;
  cid: string;
  name: string;
}
