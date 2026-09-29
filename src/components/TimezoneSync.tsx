"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { reportTimezone } from "@/lib/timezone";

/**
 * Reports the device's timezone once per load, so habits roll over at the
 * user's midnight rather than UTC's. Renders nothing.
 *
 * `stored` is what the server already has; when it matches, no call is made —
 * which is the common case, so this costs nothing on a normal page view. When
 * it differs (first visit, or the device moved zones), the page is re-read so
 * "today" is measured in the new zone straight away.
 *
 * To drop timezone support, delete this component and src/lib/timezone.ts. The
 * SQL falls back to UTC on its own.
 */
export default function TimezoneSync({ stored }: { stored: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === stored) return;
    void reportTimezone(zone).then(() => router.refresh());
  }, [stored, router]);

  return null;
}
