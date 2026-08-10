"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  COLOR_KEYS,
  BODY_TYPES,
  DEFAULT_BODY,
  DEFAULT_EYES,
  EYE_COLORS,
  FINISHED_RETENTION_DAYS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKINS,
  SLOTS,
  findItem,
} from "@/lib/game";
import { normalizeTodo } from "@/lib/types";
import type { Appearance, Equipped, XpResult } from "@/lib/types";

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

  await sql`
    update todos set
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

export async function abandonTodo(id: string): Promise<XpResult> {
  const userId = await requireUserId();
  const rows = (await sql`
    select abandon_quest(${userId}::uuid, ${id}::uuid) as result
  `) as { result: XpResult }[];
  bump();
  return rows[0].result;
}

export async function deleteTodo(id: string) {
  const userId = await requireUserId();
  await sql`delete from todos where id = ${id}::uuid and user_id = ${userId}::uuid`;
  bump();
}

/**
 * Dragging a quest onto another category. Only the category moves — where it
 * sits in that list is decided by its deadline, not by where it was dropped.
 */
export async function moveTodo(id: string, categoryId: string | null) {
  const userId = await requireUserId();
  const target = await ownCategory(userId, categoryId);

  await sql`
    update todos set category_id = ${target}::uuid
    where id = ${id}::uuid and user_id = ${userId}::uuid
  `;

  bump();
}

/**
 * Deletes completed quests past the retention window, folding their counts into
 * the durable totals first. Irreversible by design — see migration 009.
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
