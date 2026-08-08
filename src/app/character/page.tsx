import { redirect } from "next/navigation";
import CharacterStudio from "@/components/CharacterStudio";
import { sql } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED, SLOTS } from "@/lib/game";
import type { Profile, Slot } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CharacterPage({
  searchParams,
}: {
  searchParams: Promise<{ slot?: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  const { slot } = await searchParams;
  const initialSlot = SLOTS.some((s) => s.slot === slot)
    ? (slot as Slot)
    : undefined;

  const rows = (await sql`
    select * from profiles where id = ${userId}::uuid
  `) as Profile[];

  const profile = rows[0];
  if (!profile) redirect("/");

  return (
    <CharacterStudio
      initialSlot={initialSlot}
      profile={{
        ...profile,
        appearance: { ...DEFAULT_APPEARANCE, ...(profile.appearance ?? {}) },
        equipped: { ...DEFAULT_EQUIPPED, ...(profile.equipped ?? {}) },
      }}
    />
  );
}
