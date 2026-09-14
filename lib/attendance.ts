/** Attendance rule engine — the heart of the app. */
import type { AttStatus } from "@/lib/types";

export interface MarkInput {
  /** metres from the project centre (GPS accuracy caveat lives in UI) */
  distance: number;
  withinRadius: boolean;
  cutoffPassed: boolean;
  /** true when employee is standing at their CURRENTLY ASSIGNED site */
  isAssignedProject: boolean;
  /** admin/HR manually marking for someone */
  manual: boolean;
}

export interface MarkResult {
  status: AttStatus;
  /** auto-create a pending request (reason collected from user) */
  needRequest: "late" | "out_of_radius" | "site_visit" | null;
  message: string;
}

/**
 * Rules (per the brief):
 *  - at assigned site, before 11:00, inside radius  → PRESENT (auto)
 *  - at assigned site, after 11:00, inside radius   → LATE (pending approval)
 *  - outside radius anywhere                         → OUT-OF-RADIUS (pending, reason required)
 *  - at another project (site visit / transfer)      → SITE VISIT (pending approval, then paid)
 *  - manual by admin/HR                              → PRESENT, remarks recorded
 */
export function decideMarkStatus(i: MarkInput): MarkResult {
  if (i.manual) {
    return { status: "present", needRequest: null, message: "Marked by admin/HR — record saved." };
  }
  if (!i.withinRadius) {
    return {
      status: "outside_pending", needRequest: "out_of_radius",
      message: `You are ~${i.distance} m from site centre — outside the allowed radius. Reason dalo, admin approve karega tab pay milega.`,
    };
  }
  if (!i.isAssignedProject) {
    return {
      status: "visit_pending", needRequest: "site_visit",
      message: "You are at another site (visit/duty). Approval ke baad ye day paid 'On Duty' ban jayega.",
    };
  }
  if (i.cutoffPassed) {
    return {
      status: "late_pending", needRequest: "late",
      message: "11 AM ke baad check-in — late request submit ho gayi, admin approve karega.",
    };
  }
  return { status: "present", needRequest: null, message: "Present ✓ — on site before 11:00." };
}

export const FINAL_ON_APPROVE: Record<string, AttStatus> = {
  late: "late",
  out_of_radius: "on_duty",
  site_visit: "on_duty",
  on_duty: "on_duty",
  leave: "leave",
  half_day: "half_day",
};
