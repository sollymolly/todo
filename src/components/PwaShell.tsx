"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import TabBar, { TAB_PATHS } from "@/components/TabBar";
import { forgetSavedPages, startPwa, useConnectivity } from "@/lib/pwa";
import { forgetPush, resyncPush } from "@/lib/push-client";

/* --------------------------------------------------------------------------
   Wraps every page. Starts the installed-app plumbing (src/lib/pwa.ts), and
   while offline makes the page read-only: a note at the bottom saying so,
   and everything behind it `inert` — visible and scrollable, but no button
   or field can be used. A change made now couldn't be saved, and one that
   looked saved but wasn't would be worse than none.

   On a phone it also carries the tab bar, and keeps each page's end clear of
   it so the last row can always be scrolled into view.
   -------------------------------------------------------------------------- */

export default function PwaShell({ children }: { children: React.ReactNode }) {
  const { offline, savedAt } = useConnectivity();
  const pathname = usePathname();
  const tabs = TAB_PATHS.includes(pathname);

  useEffect(() => startPwa(), []);

  // Anyone on the sign-in page is signed out (signed-in visitors are sent on
  // from it), so whatever pages were saved for offline belong to no one now,
  // and this device should stop getting their notifications. Signed in, the
  // device's push subscription is re-confirmed with the server once a day.
  useEffect(() => {
    if (pathname === "/login") {
      forgetSavedPages();
      void forgetPush().catch(() => {});
    } else if (tabs) {
      void resyncPush().catch(() => {});
    }
  }, [pathname, tabs]);

  return (
    <>
      <div
        className={`relative z-10 ${tabs ? "max-sm:pb-[calc(3.5rem+env(safe-area-inset-bottom))]" : ""}`}
        inert={offline}
      >
        {children}
        {tabs && <TabBar />}
      </div>
      {offline && (
        <div
          className={`pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
            tabs ? "max-sm:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-sm:pb-3" : ""
          }`}
        >
          <p
            role="status"
            className="panel pointer-events-auto rounded-full px-4 py-2 text-center text-[13px] text-mud-700"
          >
            <b className="font-semibold text-mud-900">Offline.</b>{" "}
            {savedAt ? `Showing your quests as of ${when(savedAt)}. ` : ""}
            Changes are paused until you&apos;re back.
          </p>
        </div>
      )}
    </>
  );
}

function when(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
