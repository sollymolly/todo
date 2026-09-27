"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { unreadTotal } from "@/lib/social-actions";

/* --------------------------------------------------------------------------
   The phone's way around: four tabs along the bottom, where a thumb is.
   Phones only (below `sm`); a wider screen keeps the header's buttons, which
   is where a mouse expects them.

   Shown on the signed-in pages only — never on sign-in, reset or consent,
   where there's nowhere yet to go. Rendered by PwaShell inside the page's own
   stacking context, below every dialog (z-50), so a sheet covers it.
   -------------------------------------------------------------------------- */

export const TAB_PATHS = [
  "/",
  "/habits",
  "/friends",
  "/character",
  "/account",
  "/notifications",
  "/updates",
  "/feedback",
];

const TABS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Quests",
    icon: <path d="M5 6h14M5 12h14M5 18h9" />,
  },
  {
    href: "/habits",
    label: "Habits",
    icon: (
      <>
        <path d="M19 9a7 7 0 1 0 .6 5" />
        <path d="M19 4v5h-5" />
      </>
    ),
  },
  {
    href: "/friends",
    label: "Messages",
    icon: <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V17h0a2 2 0 0 1-2-2Z" />,
  },
  {
    href: "/character",
    label: "Me",
    icon: (
      <>
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z" />
        <path d="m9 11.5 2 2 4-4.5" />
      </>
    ),
  },
];

export default function TabBar() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Checked on every tab change, so reading a conversation clears the badge
  // by the time you're back on another tab.
  useEffect(() => {
    let live = true;
    unreadTotal()
      .then((n) => live && setUnread(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-mud-200 bg-mud-50/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md sm:hidden"
    >
      <ul className="grid grid-cols-4">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                  active ? "text-grass-700" : "text-mud-500 active:text-mud-800"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={active ? 2.2 : 1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {tab.icon}
                </svg>
                {tab.label}
                {tab.href === "/friends" && unread > 0 && (
                  <span
                    aria-label={`${unread} unread`}
                    className="absolute left-1/2 top-1.5 ml-2 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white"
                  >
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
