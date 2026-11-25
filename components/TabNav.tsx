"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const TABS = [
  { id: "tab-tender-dashboard", href: "/", label: "Enquiry to Quotation Dashboard", end: true },
  { id: "tab-sales-contract", href: "/sales-contract", label: "Sales Contract", end: false },
  { id: "tab-new-enquiry", href: "/enquiries/new", label: "New Enquiry", end: false },
  { id: "tab-reports", href: "/reports", label: "Reports", end: false },
  { id: "tab-pv", href: "/pv", label: "PV", end: false },
];

export function TabNav() {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  return (
    <nav className="tab-nav" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100 }}>
      {TABS.map((tab) => {
        const active = tab.end ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.id}
            id={tab.id}
            href={tab.href}
            className={`tab-btn${active ? " active" : ""}`}
          >
            {tab.label}
          </Link>
        );
      })}
      <div className="ml-auto flex h-full items-center gap-1">
        {status === "authenticated" ? (
          <>
            <span className="max-w-[220px] truncate text-[11px] font-semibold text-navy">
              {session.user.name || session.user.email}
            </span>
            <button type="button" className="tab-btn" onClick={() => signOut({ callbackUrl: "/" })}>
              Sign out
            </button>
          </>
        ) : status === "unauthenticated" ? (
          <Link
            href={`/signin${pathname === "/" || pathname === "/signin" || pathname === "/signup" ? "" : `?callbackUrl=${encodeURIComponent(pathname)}`}`}
            className={`tab-btn${pathname === "/signin" ? " active" : ""}`}
          >
            Sign in
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
