import bcrypt from "bcryptjs";
import type { Row } from "@/lib/types";
import { newId } from "@/lib/ids";
import { monthDates, todayStr, fmtDate } from "@/lib/time";

/**
 * Demo data for local mode (auto-seeded once into .data/db.json).
 * One company, 4 sites around Mumbai, 12 workers, real-looking history.
 * Logins are shown on the /login page when driver = local.
 */

export const DEMO_LOGINS = {
  admin: { phone: "9000000001", password: "admin@123", name: "Rajesh (Owner/Admin)" },
  hr: { phone: "9000000002", password: "hr@123", name: "Meena (HR)" },
  employee: { phone: "9000000011", password: "attend@123", name: "Sunil Yadav (Worker)" },
};

export async function seedDemoData(d: {
  Companies: Row[]; Users: Row[]; Projects: Row[]; Attendance: Row[]; Requests: Row[];
}) {
  const now = new Date().toISOString();
  const cid = newId("cmp");
  const hash = async (pw: string) => bcrypt.hash(pw, 10);

  d.Companies.push({
    id: cid, name: "Shreeji Constructions", cutoff_time: "11:00",
    default_radius_m: "50", timezone: "Asia/Kolkata", created_at: now,
  });

  // Sites — coordinates around Mumbai/Delhi so the demo map renders.
  const mk = (name: string, address: string, lat: string, lng: string, radius = "50"): Row => ({
    id: newId("prj"), company_id: cid, name, address, latitude: lat, longitude: lng,
    radius_m: radius, start_date: "2026-01-10", end_date: "2026-12-20", status: "active",
  });
  const p1 = mk("Skyline Heights — Andheri E", "Skyline Towers site, Marol, Andheri East, Mumbai", "19.1197", "72.8464");
  const p2 = mk("Metro Depot — Chembur", "Metro car-shed road, Chembur, Mumbai", "19.0611", "72.9018");
  const p3 = mk("Riverside Mall — Thane", "Near Ghodbunder Rd junction, Thane West", "19.2183", "72.9785");
  const p4 = mk("Noida Warehouse Phase 2", "Sector 62, Behind Logix, Noida", "28.6270", "77.3669", "75");
  d.Projects.push(p1, p2, p3, p4);

  const mkUser = async (
    name: string, phone: string, pw: string, role: string, project: Row, wage: string
  ): Promise<Row> => ({
    id: newId("emp"), company_id: cid, name, phone,
    password_hash: await hash(pw), role, current_project_id: project.id,
    daily_wage: wage, status: "active", created_at: now,
  });

  const admin = await mkUser("Rajesh Sharma", DEMO_LOGINS.admin.phone, DEMO_LOGINS.admin.password, "admin", p1, "0");
  const hr = await mkUser("Meena Iyer", DEMO_LOGINS.hr.phone, DEMO_LOGINS.hr.password, "hr", p1, "1200");
  const workerNames = [
    "Sunil Yadav", "Ravi Prasad", "Arjun Mehta", "Dinesh Kumar", "Vijay Singh",
    "Karan Patel", "Suresh Rana", "Mohan Das", "Rakesh Gupta", "Imran Shaikh",
    "Prakash Jha", "Deepak Verma",
  ];
  const workers: Row[] = [];
  for (let i = 0; i < workerNames.length; i++) {
    const proj = [p1, p1, p1, p1, p2, p2, p2, p3, p3, p3, p4, p4][i];
    workers.push(
      await mkUser(workerNames[i], `90000000${11 + i}`, "attend@123", "employee", proj, String(700 + (i % 4) * 50))
    );
  }
  d.Users.push(admin, hr, ...workers);

  // History: from the 1st of this month until yesterday (+ a bit of last month)
  const today = todayStr("Asia/Kolkata");
  const dates = [...monthDates(today.slice(0, 7)), ...monthDates(prevMonth(today))].filter((dt) => dt < today).sort();
  const take = dates.slice(-21);

  let rng = 7;
  const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);

  for (const w of workers) {
    for (const dt of take) {
      const dow = new Date(dt + "T00:00:00Z").getUTCDay();
      let status = "present";
      const r = rand();
      if (dt === "2026-09-06" && w === workers[3]) { /* leave below */ }
      if (dt === "2026-09-07" && w === workers[6]) { /* half day below */ }
      if (r < 0.04) status = "absent";
      else if (r < 0.12) status = "late";
      else if (r < 0.14) status = "half_day";
      else if (r < 0.155) status = "leave";
      if (dow === 0) status = "leave"; // sundays
      const projId = w.current_project_id;
      const inH = status === "present" ? 9 : 11;
      const iso = (h: number, m: number) =>
        new Date(`${dt}T${String(h - 5).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`).toISOString(); // IST -> UTC
      if (status === "absent") {
        d.Attendance.push(attRow(w, projId, dt, status, "", "", ""));
      } else {
        d.Attendance.push(
          attRow(
            w, projId, dt, status,
            iso(inH, 20 + Math.floor(rand() * 35)),
            String(Math.round(4 + rand() * 40)),
            rand() > 0.2 ? iso(inH + 8, Math.floor(rand() * 59)) : ""
          )
        );
      }
    }
  }

  // Two open requests so the admin queue isn't empty
  d.Requests.push({
    id: newId("req"), company_id: cid, employee_id: workers[2].id, type: "on_duty",
    reason: "Material shifting — sent to Noida warehouse with truck",
    from_date: fmtDate(new Date(Date.now() - 86400000), "Asia/Kolkata"),
    to_date: today, project_id: p4.id, attendance_id: "", status: "pending",
    review_note: "", reviewed_by: "", reviewed_at: "", created_at: now,
  });
  d.Requests.push({
    id: newId("req"), company_id: cid, employee_id: workers[9].id, type: "late",
    reason: "Bus late thi, site 9 baje hi milta",
    from_date: fmtDate(new Date(Date.now() - 2 * 86400000), "Asia/Kolkata"),
    to_date: fmtDate(new Date(Date.now() - 2 * 86400000), "Asia/Kolkata"),
    project_id: p3.id, attendance_id: "", status: "pending",
    review_note: "", reviewed_by: "", reviewed_at: "", created_at: now,
  });
}

function attRow(w: Row, projId: string, date: string, status: string, inTime: string, dist: string, outTime: string): Row {
  return {
    id: newId("att"), company_id: w.company_id, employee_id: w.id, project_id: projId,
    date,
    check_in_time: inTime, check_in_lat: "0", check_in_lng: "0", check_in_distance_m: dist,
    check_out_time: outTime, check_out_lat: "0", check_out_lng: "0", check_out_distance_m: "",
    status,
    remarks: status === "late" ? "approved: traffic" : "",
    approved_by: status === "present" || status === "late" ? "" : "",
  };
}

function prevMonth(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
