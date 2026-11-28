"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { GROUPS, GROUP_SUMMARY, PAGES, groupKey } from "@/lib/pages";
import { getPageSummariesAction } from "@/actions/pageSummary";

const tipId = (key: string) => `tip-${key.replace(/[^a-z0-9]+/gi, "-")}`;

/** The page groups. `tab` is the ?tab= of a report page, or null while it is not known yet. `saved` holds Puja's edited hover summaries. */
function Groups({ tab, saved }: { tab: string | null; saved: Record<string, string> }) {
  const pathname = usePathname();
  // /reports without ?tab= shows the first report (Item wise breakup)
  const here = pathname === "/reports" ? `/reports?tab=${tab ?? "items"}` : pathname;
  const isCurrent = (href: string) => href === here || (href !== "/" && !href.includes("?") && pathname.startsWith(href));

  return (
    <>
      {GROUPS.map(group => {
        const pages = PAGES.filter(p => p.group === group);
        const active = pages.some(p => isCurrent(p.href));
        const about = saved[groupKey(group)] ?? GROUP_SUMMARY[group];
        // a group with one page is a plain link; the others open a menu on hover or keyboard focus
        if (pages.length === 1) {
          const p = pages[0];
          return (
            <div key={group} className="tab-group">
              <Link href={p.href} className={`tab-btn${active ? " active" : ""}`} aria-describedby={tipId(p.href)}>{group}</Link>
              <span role="tooltip" id={tipId(p.href)} className="tab-tip tab-tip-below">{saved[p.href] ?? p.summary}</span>
            </div>
          );
        }
        return (
          <div key={group} className="tab-group">
            <button type="button" className={`tab-btn${active ? " active" : ""}`} aria-haspopup="true" aria-describedby={tipId(groupKey(group))}>{group} ▾</button>
            <div className="tab-menu">
              <p id={tipId(groupKey(group))} className="tab-menu-note">{about}</p>
              {pages.map(p => (
                <div key={p.href} className="tab-menu-row">
                  <Link href={p.href} aria-current={isCurrent(p.href) ? "page" : undefined} aria-describedby={tipId(p.href)}
                    className={`tab-menu-item${isCurrent(p.href) ? " active" : ""}`}>
                    {p.label}
                  </Link>
                  <span role="tooltip" id={tipId(p.href)} className="tab-tip">{saved[p.href] ?? p.summary}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function GroupsForUrl({ saved }: { saved: Record<string, string> }) {
  return <Groups tab={useSearchParams().get("tab")} saved={saved} />;
}

export function TabNav() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  // Edited summaries arrive after the first paint (the drafts show until then), so static pages stay static.
  const [saved, setSaved] = useState<Record<string, string>>({});
  useEffect(() => { getPageSummariesAction().then(setSaved).catch(() => {}); }, [pathname]);

  return (
    <nav className="tab-nav" aria-label="Main" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100 }}>
      {/* Only the part that reads ?tab= sits in the Suspense boundary Next requires. The sign-in area must stay outside it:
          a suspended boundary hydrates late, after the session has loaded, and then no longer matches the server HTML. */}
      <Suspense fallback={<Groups tab={null} saved={saved} />}><GroupsForUrl saved={saved} /></Suspense>
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
