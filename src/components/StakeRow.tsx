import { XP } from "@/lib/game";

/* --------------------------------------------------------------------------
   The three outcomes of a quest, stated as plain numbers. Without a deadline
   only the first is in play, so the other two are shown struck out rather
   than hidden — the contrast is the point.
   -------------------------------------------------------------------------- */

export default function StakeRow({ hasDeadline }: { hasDeadline: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Stake
        label="Completed"
        value={`+${hasDeadline ? XP.onTime : XP.noDeadline}`}
        tone="good"
      />
      <Stake
        label="Late"
        value={hasDeadline ? `+${XP.late}` : "—"}
        tone={hasDeadline ? "warn" : "off"}
      />
      <Stake
        label="Not completed"
        value={hasDeadline ? `${XP.penalty}` : "—"}
        tone={hasDeadline ? "bad" : "off"}
      />
    </div>
  );
}

function Stake({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "off";
}) {
  const styles = {
    good: "border-grass-300 bg-grass-100 text-grass-700",
    warn: "border-amber-300 bg-amber-100 text-amber-800",
    bad: "border-red-300 bg-red-100 text-red-800",
    off: "border-mud-200 bg-mud-50 text-mud-400",
  }[tone];

  return (
    <div className={`rounded-lg border px-2 py-1.5 text-center ${styles}`}>
      <p className="font-mono text-sm font-bold tabular-nums">{value} XP</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </p>
    </div>
  );
}
