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
  HAIR_COLORS,
  HAIR_STYLES,
  SKINS,
  SLOTS,
  findItem,
  levelFor,
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

  // Returns the created row so the client can show it immediately.
  const rows = (await sql`
    insert into todos (user_id, title, notes, due_date, category_id, position)
    values (
      ${userId}::uuid,
      ${title.slice(0, 200)},
      ${notes},
      ${input.dueDate || null}::timestamptz,
      ${input.categoryId || null}::uuid,
      (select coalesce(max(position), 0) + 1024 from todos where user_id = ${userId}::uuid)
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

  await sql`
    update todos set
      title       = ${title.slice(0, 200)},
      notes       = ${notes},
      due_date    = ${next.dueDate || null}::timestamptz,
      category_id = ${next.categoryId || null}::uuid
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
 * Drag-and-drop. `position` is the midpoint between the neighbours a quest was
 * dropped between, so only the dragged row is written — no renumbering.
 */
export async function moveTodo(
  id: string,
  categoryId: string | null,
  position?: number
) {
  const userId = await requireUserId();

  if (position === undefined) {
    await sql`
      update todos set category_id = ${categoryId || null}::uuid
      where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
  } else {
    await sql`
      update todos
         set category_id = ${categoryId || null}::uuid,
             position    = ${position}
       where id = ${id}::uuid and user_id = ${userId}::uuid
    `;
  }

  bump();
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

export async function addCategory(input: {
  name: string;
  icon: string;
  color: string;
}) {
  const userId = await requireUserId();

  const name = input.name.trim();
  if (!name) throw new Error("Give the category a name");

  await sql`
    insert into categories (user_id, name, icon, color, sort_order)
    values (
      ${userId}::uuid,
      ${name.slice(0, 40)},
      ${input.icon || "📜"},
      ${COLOR_KEYS.includes(input.color) ? input.color : "amber"},
      (select coalesce(max(sort_order) + 1, 0) from categories where user_id = ${userId}::uuid)
    )
  `;

  bump();
}

export async function updateCategory(
  id: string,
  patch: { name?: string; icon?: string; color?: string }
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
      icon  = coalesce(${patch.icon ?? null}, icon),
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
    select xp, equipped from profiles where id = ${userId}::uuid
  `) as { xp: number; equipped: Equipped }[];

  if (rows.length === 0) throw new Error("Profile not found");

  const level = levelFor(rows[0].xp);
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
