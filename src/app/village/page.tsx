import Link from "next/link";
import { redirect } from "next/navigation";
import Village from "@/components/village/Village";
import { getUserId } from "@/lib/session";
import { loadVillage, type VillageData } from "@/lib/village-server";

export const dynamic = "force-dynamic";

export default async function VillagePage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let data: VillageData | null = null;
  let missing = false;
  try {
    data = await loadVillage(userId);
  } catch (e) {
    missing = /relation .* does not exist|column .* does not exist|function .* does not exist/i.test(String(e));
    if (!missing) throw e;
  }

  if (!data)
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="panel max-w-lg rounded-2xl p-7">
          <h1 className="font-display text-2xl font-bold text-mud-900">The village isn&apos;t built yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-mud-700">
            Run <code>db/migrations/026-village.sql</code> in the Neon SQL Editor, then reload.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm font-semibold text-grass-700">
            ← Back to quests
          </Link>
        </div>
      </main>
    );

  return <Village data={data} />;
}
