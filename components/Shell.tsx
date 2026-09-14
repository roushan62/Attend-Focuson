"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // emoji keeps deps at zero
}

/**
 * Mobile-first shell: top bar + bottom tab bar (phone), left sidebar (tablet/desktop).
 * One component serves both employee and admin, driven by `items`.
 */
export default function Shell({
  items, userName, role, companyName, badge = 0, children,
}: {
  items: NavItem[];
  userName: string;
  role: string;
  companyName: string;
  badge?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const bottom = items.slice(0, 4);
  const rest = items.slice(4);
  const active = (href: string) =>
    pathname === href || (href.split("/").length > 2 && pathname.startsWith(href + "/"));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const hasBadge = (it: NavItem) => badge > 0 && (it.href.includes("requests") || it.href.includes("approval"));

  return (
    <div className="min-h-dvh">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="hidden text-sm font-bold sm:block">SiteAttend</span>
          </Link>
          <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-slate-200">
            {companyName}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold capitalize text-amber-300 sm:block">
              {role}
            </span>
            <button onClick={logout} className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700" title="Logout">
              ⎋ Logout
            </button>
          </div>
        </div>
      </header>

      {/* desktop sidebar */}
      <aside className="pointer-events-none fixed inset-y-0 left-0 z-20 hidden w-56 md:block">
        <nav className="pointer-events-auto mx-3 mt-6 flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 px-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            {userName} · {role}
          </div>
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                active(it.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span>{it.icon}</span> {it.label}
              {hasBadge(it) && (
                <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </aside>

      {/* content */}
      <main className="safe-bottom mx-auto max-w-4xl px-4 py-5 md:pl-60">
        <div className="mb-1 flex items-center justify-between md:hidden">
          <span className="text-xs text-slate-500">👋 {userName}</span>
          {rest.length > 0 && (
            <button onClick={() => setMore(true)} className="text-xs font-semibold text-slate-700 underline">
              More ▾
            </button>
          )}
        </div>
        {children}
      </main>

      {/* bottom tab bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-900 pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
          {bottom.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-medium ${
                active(it.href) ? "text-amber-300" : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="text-lg leading-none">{it.icon}</span>
              <span>{it.label}</span>
              {hasBadge(it) && (
                <span className="absolute -top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          ))}
          {rest.length > 0 && (
            <button
              onClick={() => setMore(true)}
              className="relative flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-medium text-slate-400"
            >
              <span className="text-lg leading-none">⋯</span>
              <span>More</span>
            </button>
          )}
        </div>
      </nav>

      {/* more sheet (mobile) */}
      {more && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-sm font-bold">Menu</div>
            <div className="grid grid-cols-2 gap-2">
              {rest.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setMore(false)}
                  className={`flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium ${
                    active(it.href) ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700"
                  }`}
                >
                  <span>{it.icon}</span> {it.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
