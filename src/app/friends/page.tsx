import { redirect } from "next/navigation";
import Friends from "@/components/Friends";
import { getUserId } from "@/lib/session";
import { listFriends, listRequests, myKeys } from "@/lib/social-actions";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let data: Awaited<ReturnType<typeof loadAll>> | null = null;
  let message = "";

  try {
    data = await loadAll();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  if (data) {
    return (
      <Friends
        friends={data.friends}
        requests={data.requests}
        meId={userId}
        hasKeys={!!data.keys.publicKey}
      />
    );
  }

  const needsMigration =
    /relation .* does not exist|column .* does not exist|function .* does not exist/i.test(
      message
    );

  return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="panel max-w-lg rounded-2xl p-7">
          <h1 className="font-display text-2xl font-bold text-mud-900">
            Almost there
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-mud-700">
            {needsMigration ? (
              <>
                Companions need one more migration. Open the Neon SQL Editor,
                paste{" "}
                <code className="rounded bg-mud-800 px-1.5 py-0.5 text-mud-50">
                  db/migrations/002-social.sql
                </code>{" "}
                and run it, then reload.
              </>
            ) : (
              "Could not load your companions."
            )}
          </p>
          <p className="mt-4 break-words rounded-lg bg-mud-100 px-3 py-2 font-mono text-xs text-red-800">
            {message}
          </p>
        </div>
      </main>
  );
}

async function loadAll() {
  const [friends, requests, keys] = await Promise.all([
    listFriends(),
    listRequests(),
    myKeys(),
  ]);
  return { friends, requests, keys };
}
