import { requireSession } from "@/lib/auth";
import { byId, list } from "@/lib/db";
import Shell, { type NavItem } from "@/components/Shell";

export const dynamic = "force-dynamic";

/** Admin/HR shell — same phone, same app, different tabs. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession(["admin", "hr"]);
  const company = await byId("Companies", s.cid);
  const pending = (
    await list("Requests", (r) => r.company_id === s.cid && r.status === "pending")
  ).length;

  const items: NavItem[] = [
    { href: "/admin", label: "Today", icon: "🏗️" },
    { href: "/admin/attendance", label: "Attendance", icon: "🗓️" },
    { href: "/admin/requests", label: "Approvals", icon: "✅" },
    { href: "/admin/reports", label: "Payroll", icon: "💰" },
    { href: "/admin/projects", label: "Sites", icon: "📍" },
    { href: "/admin/employees", label: "Team", icon: "👥" },
    { href: "/admin/settings", label: "Settings", icon: "⚙️" },
  ];

  return (
    <Shell items={items} userName={s.name} role={s.role} companyName={company?.name ?? ""} badge={pending}>
      {children}
    </Shell>
  );
}
