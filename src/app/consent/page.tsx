import { redirect } from "next/navigation";
import ConsentGate from "@/components/ConsentGate";
import Scenery from "@/components/Scenery";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { refreshConsentSession } from "@/lib/auth-actions";
import { PRIVACY_VERSION } from "@/lib/policy";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // Someone who agreed on another device arrives with a stale cookie. Trust the
  // database over the cookie and re-issue it, rather than asking a second time
  // for an agreement they've already given.
  if (session.privacyVersion < PRIVACY_VERSION) {
    if (await refreshConsentSession()) redirect("/");
  }

  let displayName = "Adventurer";
  try {
    const rows = (await sql`
      select display_name from profiles where id = ${session.userId}::uuid
    `) as { display_name: string }[];
    if (rows[0]?.display_name) displayName = rows[0].display_name;
  } catch {
    /* the greeting is cosmetic — never block the gate on it */
  }

  return (
    <>
      <Scenery />
      <ConsentGate displayName={displayName} />
    </>
  );
}
