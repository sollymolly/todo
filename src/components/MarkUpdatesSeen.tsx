"use client";

import { useEffect } from "react";
import { markUpdatesSeen } from "@/lib/feedback-actions";

/* Opening the changelog is what counts as having seen it, and clears the dot
   on the menu. A client effect rather than a write during the page render,
   because markUpdatesSeen revalidates, which a render is not allowed to do. */
export default function MarkUpdatesSeen({ week }: { week: string }) {
  useEffect(() => {
    void markUpdatesSeen(week);
  }, [week]);
  return null;
}
