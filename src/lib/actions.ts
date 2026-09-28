"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  COLOR_KEYS,
  BODY_TYPES,
  DEFAULT_BODY,
  DEFAULT_EYES,
  DYE_SLOTS,
  EYE_COLORS,
  FINISHED_RETENTION_DAYS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKINS,
  SLOTS,
  dyesFor,
  findItem,
} from "@/lib/game";
import { normalizeTodo } from "@/lib/types";
import type { Appearance, DyeSlot, Equipped, XpResult } from "@/lib/types";

/* --------------------------------------------------------------------------
   Every write goes through here, and every statement is scoped by user_id —
   that scoping is what keeps one account's rows out of another's, so never
   drop the `and user_id = ${userId}` clause from a query in this file.
   -------------------------------------------------------------------------- */

function bump() {
  revalidatePath("/");
  revalidatePath("/character");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a category id, or null if it isn't one of the caller's.
 *
 * Scoping the *quest* by user_id was never enough on its own: `category_id`
 * was written straight through from the client, so anyone could file their own
 * quest under a stranger's category id. Nothing of theirs became readable, but
 * the friends-list open-counts tally by category_id alone, so it let one
 * account inflate the numbers other people see on someone else's profile.
 *
 * The regex guard matters too — a non-UUID string would reach `::uuid` and
 * come back as a Postgres cast error, which is a needless error-message oracle.
 */
async function ownCategory(
  userId: string,
  categoryId?: string | null
): Promise<string | null> {
  if (!categoryId || !UUID.test(categoryId)) return null;
  const rows = (await sql`
    select id from categories
     where id = ${categoryId}::uuid and user_id = ${userId}::uuid
  `) as { id: string }[];
  return rows[0]?.id ?? null;
}

/* ========================================================================== */
/* Quests                                                                     */
/* ========================================================================== */

export async function addTodo(input: {
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  categoryId?: string | null;
}) {
  const userId = await requireUserId();

  const title = input.title.trim();
  if (!title) throw new Error("A quest needs a name");

  const notes = input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null;
  const categoryId = await ownCategory(userId, input.categoryId);

  // Returns the created row so the client can show it immediately.
  const rows = (await sql`
    insert into todos (user_id, title, notes, due_date, category_id)
    values (
      ${userId}::uuid,
      ${title.slice(0, 200)},
      ${notes},
      ${input.dueDate || null}::timestamptz,
      ${categoryId}::uuid
    )
    returning *
  `) as Record<string, unknown>[];

  bump();
  return normalizeTodo(rows[0]);
}

/**
 * Adds several quests at once — the reviewed result of a screenshot import.
 * The same checks as addTodo, one statement for the lot, so a list of twenty
 * lands together rather than trickling in over twenty round trips.
 */
export async function addTodos(
  drafts: { title: string; dueDate: string | null; categoryId: string | null }[]
) {
  const userId = await requireUserId();

  const rows: { title: string; due: string | null; category: string | null }[] = [];
  const owned = new Map<string | null, string | null>();
  for (const d of drafts.slice(0, 50)) {
    const title = typeof d.title === "string" ? d.title.trim().slice(0, 200) : "";
    if (!title) continue;
    const due = d.dueDate && !isNaN(new Date(d.dueDate).getTime()) ? d.dueDate : null;
    if (!owned.has(d.categoryId)) owned.set(d.categoryId, await ownCategory(userId, d.categoryId));
    rows.push({ title, due, category: owned.get(d.categoryId) ?? null });
  }
  if (rows.length === 0) return [];

  // A JSON document rather than parallel arrays: nulls survive it unambiguously.
  const created = (await sql`
    insert into todos (user_id, title, due_date, category_id)
    select ${userId}::uuid, x.title, x.due, x.category
      from json_to_recordset(${JSON.stringify(rows)}::json)
        as x(title text, due timestamptz, category uuid)
    returning *
  `) as Record<string, unknown>[];

  bump();
  return created.map(normalizeTodo);
}

export async function updateTodo(
  id: string,
  next: {
    title: string;
    notes: string | null;
    dueDate: string | null;
    categoryId: string | null;
  }
) {
  const userId = await requireUserId();

  const title = next.title.trim();
  if (!title) throw new Error("A quest needs a name");

  const notes = next.notes?.trim() ? next.notes.trim().slice(0, 2000) : null;
  const categoryId = await ownCategory(userId, next.categoryId);

  // A new deadline or a new category hands the quest back to deadline order
  // (see boardOrder): a hand-placed position would otherwise pin it where it
  // was, which is exactly the "edited the date and nothing moved" complaint
  // that once removed manual ordering altogether. On the right-hand side the
  // columns still hold their old values, which is what makes the comparison.
  await sql`
    update todos set
      position    = case
                      when due_date is distinct from ${next.dueDate || null}::timestamptz
                        or category_id is distinct from ${categoryId}::uuid
                      then null
                      else position
                    end,
      title       = ${title.slice(0, 200)},
      notes       = ${notes},
      due_date    = ${next.dueDate || null}::timestamptz,
      category_id = ${categoryId}::uuid
    where id = ${id}::uuid and user_id = ${userId}::uuid
  `;

  bump();
}

export async function completeTodo(id: string): Promise<XpResult> {
  const userId = await requireUserId();

  const rows = (await sql`
    select complete_quest(${userId}::uuid, ${id}::uuid) as result
  `) as { result: XpResult }[];

  bump();
  return rows[0].result;
}

export async function uncompleteTodo(id: string): Promise<XpResult> {
  const userId = await requireUserId();

  const rows = (await sql`
    select uncomplete_quest(${userId}::uuid, ${id}::uuid) as result
  `) as { result: XpResult }[];

  bump();
  return rows[0].result;
}

/**
 * Giving up on a quest: the penalty is charged, the missed deadline is recorded
 * against the category, and the quest itself is deleted. Only the counter
 * survives — see db/schema.sql for why the miss has to outlive the row.
 */
export async function abandonTodo(id: string): Promise<XpResult> {
  const userId = await requireUserId();
  const rows = (await sql`
    select abandon_quest(${userId}::uuid, ${id}::uuid) as result
  `) as { result: XpResult }[];
  bump();
  revalidatePath("/habits");
  return rows[0].result;
}

/**
 * Removing a quest that should never have existed. Counts as nothing, and hands
 * back whatever XP it had moved — so deleting a finished quest returns its
 * award. Abandoning is the way to give up on something real.
 */
export async function deleteTodo(id: string): Promise<XpResult> {
  const userId = await requireUserId();
  const rows = (await sql`
    select delete_quest(${userId}::uuid, ${id}::uuid) as result
  `) as { result: XpResult }[];
  bump();
  revalidatePath("/habits");
  return rows[0].result;
}

/**
 * Dropping a quest into a box — its own or another category's. `orderedIds` is
 * that box's whole list in its new order, and every quest in it is renumbered,
 * so the order survives exactly as it was shown.
 *
 * The whole list rather than just the dropped quest's neighbours because a box
 * can hold quests that were never placed (position null, slotted by deadline);
 * their order only exists on screen until something writes it down.
 */
export async function placeTodo(
  id: string,
  categoryId: string | null,
  orderedIds: string[]
) {
  const userId = await requireUserId();
  const target = await ownCategory(userId, categoryId);

  const ids = orderedIds.filter((x) => UUID.test(x)).slice(0, 500);
  if (!UUID.test(id) || !ids.includes(id)) throw new Error("Could not move that quest");

  await sql`
    update todos set category_id = ${target}::uuid
    where id = ${id}::uuid and user_id = ${userId}::uuid
  `;

  // Only quests that really are the caller's and really are in that box —
  // a stale list can't reach into another category's order.
  await sql`
    update todos t set position = o.n * 1024
      from unnest(${ids}::uuid[]) with ordinality as o(id, n)
     where t.id = o.id
       and t.user_id = ${userId}::uuid
       and t.category_id is not distinct from ${target}::uuid
  `;

  bump();
}

/**
 * Dragging a row in the table view. `orderedIds` is the whole
 * table in its new order, renumbered for the same reason placeTodo takes a
 * whole box: unplaced quests only have an order on screen until it's written.
 *
 * No bump(): the table already shows the new order, and a refresh here could
 * bring back the saved layout before the switch to the "Manual" sort that
 * came with this drag has landed, snapping the rows back to the old sort.
 */
export async function orderTable(orderedIds: string[]) {
  const userId = await requireUserId();
  const ids = orderedIds.filter((x) => UUID.test(x)).slice(0, 1000);
  if (!ids.length) return;

  await sql`
    update todos t set table_position = o.n * 1024
      from unnest(${ids}::uuid[]) with ordinality as o(id, n)
     where t.id = o.id
       and t.user_id = ${userId}::uuid
  `;
}

/**
 * Dragging a section (a category's box) into a new place on the board.
 * `orderedIds` is every category in its new order; sort_order is rewritten
 * from it, so it also tidies any gaps or ties left by older data.
 */
export async function reorderCategories(orderedIds: string[]) {
  const userId = await requireUserId();
  const ids = orderedIds.filter((x) => UUID.test(x)).slice(0, 200);

  await sql`
    update categories c set sort_order = o.n - 1
      from unnest(${ids}::uuid[]) with ordinality as o(id, n)
     where c.id = o.id
       and c.user_id = ${userId}::uuid
  `;

  bump();
}

/**
 * Deletes completed quests past the retention window, folding their counts into
 * the durable totals first. Irreversible by design — see db/schema.sql.
 */
export async function pruneFinished(): Promise<number> {
  const userId = await requireUserId();
  const rows = (await sql`
    select prune_finished(${userId}::uuid, ${FINISHED_RETENTION_DAYS}::int) as n
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Auto-fails quests more than 24h past their deadline. Called on page load. */
export async function sweepOverdue(): Promise<{
  count: number;
  delta: number;
  xp: number;
}> {
  const userId = await requireUserId();
  const rows = (await sql`select sweep_overdue(${userId}::uuid) as result`) as {
    result: { count: number; delta: number; xp: number };
  }[];
  return rows[0].result;
}

/* ========================================================================== */
/* Categories                                                                 */
/* ========================================================================== */

export async function addCategory(input: { name: string; color: string }) {
  const userId = await requireUserId();

  const name = input.name.trim();
  if (!name) throw new Error("Give the category a name");

  await sql`
    insert into categories (user_id, name, color, sort_order)
    values (
      ${userId}::uuid,
      ${name.slice(0, 40)},
      ${COLOR_KEYS.includes(input.color) ? input.color : "amber"},
      (select coalesce(max(sort_order) + 1, 0) from categories where user_id = ${userId}::uuid)
    )
  `;

  bump();
}

export async function updateCategory(
  id: string,
  patch: { name?: string; color?: string }
) {
  const userId = await requireUserId();

  const name = patch.name?.trim();
  if (patch.name !== undefined && !name)
    throw new Error("Give the category a name");

  const color =
    patch.color !== undefined && COLOR_KEYS.includes(patch.color)
      ? patch.color
      : null;

  await sql`
    update categories set
      name  = coalesce(${name?.slice(0, 40) ?? null}, name),
      color = coalesce(${color}, color)
    where id = ${id}::uuid and user_id = ${userId}::uuid
  `;

  bump();
}

/** Deleting a category leaves its quests intact, just uncategorised. */
export async function deleteCategory(id: string) {
  const userId = await requireUserId();
  await sql`delete from categories where id = ${id}::uuid and user_id = ${userId}::uuid`;
  bump();
}

/* ========================================================================== */
/* Character                                                                  */
/* ========================================================================== */

export async function saveAppearance(appearance: Appearance) {
  const userId = await requireUserId();

  // Only accept values that exist in the catalogue.
  const clean: Appearance = {
    body: BODY_TYPES.some((b) => b.id === appearance.body)
      ? appearance.body
      : DEFAULT_BODY,
    skin: SKINS.some((s) => s.id === appearance.skin) ? appearance.skin : "fair",
    hair: HAIR_STYLES.some((h) => h.id === appearance.hair)
      ? appearance.hair
      : "tousled",
    hairColor: HAIR_COLORS.some((h) => h.id === appearance.hairColor)
      ? appearance.hairColor
      : "chestnut",
    // Accounts created before eyes had art stored style names like "bright";
    // those aren't colours, so they land on the default.
    eyes: EYE_COLORS.some((e) => e.id === appearance.eyes)
      ? appearance.eyes
      : DEFAULT_EYES,
  };

  await sql`
    update profiles set appearance = ${JSON.stringify(clean)}::jsonb
    where id = ${userId}::uuid
  `;

  bump();
}

/** Equipping is gated on level, checked here rather than trusted from the client. */
export async function saveEquipped(equipped: Equipped) {
  const userId = await requireUserId();

  const rows = (await sql`
    select level, equipped from profiles where id = ${userId}::uuid
  `) as { level: number; equipped: Equipped }[];

  if (rows.length === 0) throw new Error("Profile not found");

  // The stored high-water level, not one re-derived from current XP. Deriving
  // it was what let a missed deadline silently unequip earned armour.
  const level = rows[0].level ?? 1;
  const clean = { ...rows[0].equipped } as Equipped;

  for (const { slot } of SLOTS) {
    const item = findItem(slot, equipped[slot]);
    if (item && item.level <= level) clean[slot] = item.id;
  }

  // Dyes have nothing to gate them on — the armour was the achievement — but
  // one still has to name a colour the item being saved can actually wear, so
  // a hand-rolled request can't store a ramp that has no art behind it.
  // Unrecognised picks leave the slot's stored dye alone rather than clearing
  // it: swapping a dyed tunic for plate and back should bring the colour back.
  const dyes: Partial<Record<DyeSlot, string>> = { ...clean.dyes };
  for (const slot of DYE_SLOTS) {
    const want = equipped.dyes?.[slot];
    if (want && dyesFor(findItem(slot, clean[slot])).some((d) => d.id === want)) {
      dyes[slot] = want;
    }
  }
  clean.dyes = dyes;

  await sql`
    update profiles set equipped = ${JSON.stringify(clean)}::jsonb
    where id = ${userId}::uuid
  `;

  bump();
}

export async function saveDisplayName(name: string) {
  const userId = await requireUserId();
  const clean = name.trim().slice(0, 40) || "Adventurer";

  await sql`update profiles set display_name = ${clean} where id = ${userId}::uuid`;
  bump();
}
