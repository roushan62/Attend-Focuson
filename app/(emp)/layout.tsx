import { requireSession } from "@/lib/auth";
import { byId, list } from "@/lib/db";
import Shell, { type NavItem } from "@/components/Shell";

export const dynamic = "force-dynamic";

/** Employee tab bar. Pending-approval badge counts open requests. */
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const company = await byId("Companies", s.cid);
  const pending = (
    await list("Requests", (r) => r.company_id === s.cid && r.employee_id === s.uid && r.status === "pending")
  ).length;

  const items: NavItem[] = [
    { href: "/dashboard", label: "Today", icon: "🏗️" },
    { href: "/projects", label: "Sites", icon: "📍" },
    { href: "/history", label: "History", icon: "🗓️" },
    { href: "/requests", label: "Requests", icon: "📨" },
    { href: "/profile", label: "Profile", icon: "👤" },
  ];

  return (
    <Shell items={items} userName={s.name} role={s.role} companyName={company?.name ?? ""} badge={pending}>
      {children}
    </Shell>
  );
}
