"use client";

import { useEffect } from "react";
import { reportTimezone } from "@/lib/timezone";

/**
 * Reports the browser's timezone once per load, so habits can roll over at the
 * user's midnight rather than UTC's. Renders nothing.
 *
 * `stored` is what the server already has; when it matches, no call is made —
 * which is the common case, so this costs nothing on a normal page view.
 *
 * To drop timezone support, delete this component and src/lib/timezone.ts. The
 * SQL falls back to UTC on its own.
 */
export default function TimezoneSync({ stored }: { stored: string | null }) {
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === stored) return;
    void reportTimezone(zone);
  }, [stored]);

  return null;
}
