import { redirect } from "next/navigation";
import FeedbackForm from "@/components/FeedbackForm";
import Scenery from "@/components/Scenery";
import { getUserId } from "@/lib/session";
import { amOwner, listFeedback } from "@/lib/feedback-actions";

export const dynamic = "force-dynamic";

export default async function FeedbackPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  // listFeedback re-checks ownership itself, so this only decides whether to
  // render the section at all.
  let isOwner = false;
  let notes: Awaited<ReturnType<typeof listFeedback>> = [];
  try {
    isOwner = await amOwner();
    if (isOwner) notes = await listFeedback();
  } catch {
    /* a missing table shouldn't stop anyone leaving feedback */
  }

  return (
    <>
      <Scenery />
      <FeedbackForm notes={notes} isOwner={isOwner} />
    </>
  );
}
