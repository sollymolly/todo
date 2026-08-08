import { redirect } from "next/navigation";
import AccountForm from "@/components/AccountForm";
import { myAccount } from "@/lib/auth-actions";
import { getUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let account: Awaited<ReturnType<typeof myAccount>> = null;
  let message = "";

  try {
    account = await myAccount();
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }

  if (account) return <AccountForm account={account} />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="panel max-w-lg rounded-2xl p-7">
        <h1 className="font-display text-2xl font-bold text-mud-900">
          Almost there
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-mud-700">
          {/column .* does not exist/i.test(message)
            ? "Your database is behind — run db/migrations/002-social.sql in the Neon SQL Editor, then reload."
            : "Could not load your account."}
        </p>
        {message && (
          <p className="mt-4 break-words rounded-lg bg-mud-100 px-3 py-2 font-mono text-xs text-red-800">
            {message}
          </p>
        )}
      </div>
    </main>
  );
}
