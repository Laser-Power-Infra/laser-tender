"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { id: "tab-tender-dashboard", href: "/", label: "Enquiry to Quotation Dashboard", end: true },
  { id: "tab-sales-contract", href: "/sales-contract", label: "Sales Contract", end: false },
];

export function TabNav() {
  const pathname = usePathname();

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
    </nav>
  );
}
