export type QuestStatus = "open" | "done" | "failed";

export type Slot = "torso" | "weapon" | "head" | "cape" | "offhand";

/** Which LPC body the sprite is drawn on. Gear is fetched per body. */
export type BodyType = "male" | "female";

export type Appearance = {
  body: BodyType;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
};

export type Equipped = Record<Slot, string>;

export type Profile = {
  id: string;
  display_name: string;
  xp: number;
  appearance: Appearance;
  equipped: Equipped;
  created_at: string;
};

export type Category = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type Todo = {
  id: string;
  user_id: string;
  category_id: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: QuestStatus;
  completed_at: string | null;
  xp_awarded: number;
  position: number | null;
  created_at: string;
};

export type XpResult = {
  delta: number;
  xp: number;
  reason?: string;
};

/* --------------------------------------------------------------------------
   The Neon driver hands back `timestamptz` columns as Date objects, while the
   same rows arrive as ISO strings once they have crossed the server/client
   boundary. Everything downstream compares them as strings, so normalise at
   the point rows leave SQL.
   -------------------------------------------------------------------------- */

function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export function normalizeTodo(row: Record<string, unknown>): Todo {
  return {
    ...(row as unknown as Todo),
    due_date: iso(row.due_date),
    completed_at: iso(row.completed_at),
    created_at: iso(row.created_at) ?? new Date(0).toISOString(),
  };
}
