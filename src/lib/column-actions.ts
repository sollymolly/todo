"use server";

import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import {
  cleanLayout,
  cleanOptions,
  cleanValue,
  MAX_CUSTOM_COLUMNS,
  type ColumnKind,
  type ColumnValues,
  type TableColumn,
  type TableLayout,
} from "@/lib/table-columns";

/* --------------------------------------------------------------------------
   Custom table columns and the table's layout — see db/schema.sql.

   Every statement is scoped by user_id, like everything in actions.ts. A
   value is only written after it has been checked against its column's kind,
   so a text column can't end up holding an object, or a select an option
   that doesn't exist.
   -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_SET = new Set<ColumnKind>(["text", "number", "checkbox", "select", "date"]);

/** Everything the table needs beyond the quests themselves. */
export async function loadTableData(): Promise<{
  columns: TableColumn[];
  values: ColumnValues;
}> {
  const userId = await requireUserId();
  const [columns, rows] = await Promise.all([
    sql`
      select id, name, kind, options from table_columns
       where user_id = ${userId}::uuid
       order by created_at
    `,
    sql`
      select todo_id, column_id, value from todo_values
       where user_id = ${userId}::uuid
    `,
  ]);

  const values: ColumnValues = {};
  for (const r of rows as { todo_id: string; column_id: string; value: unknown }[]) {
    (values[r.todo_id] ??= {})[r.column_id] = r.value as ColumnValues[string][string];
  }
  return {
    columns: (columns as TableColumn[]).map((c) => ({ ...c, options: cleanOptions(c.options) })),
    values,
  };
}

async function ownColumn(userId: string, id: string): Promise<TableColumn | null> {
  if (!UUID.test(id)) return null;
  const rows = (await sql`
    select id, name, kind, options from table_columns
     where id = ${id}::uuid and user_id = ${userId}::uuid
  `) as TableColumn[];
  return rows[0] ? { ...rows[0], options: cleanOptions(rows[0].options) } : null;
}

function cleanName(name: string): string {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (!n) throw new Error("A column needs a name");
  return n;
}

export async function addColumn(input: { name: string; kind: ColumnKind }): Promise<TableColumn> {
  const userId = await requireUserId();
  const name = cleanName(input.name);
  if (!KIND_SET.has(input.kind)) throw new Error("Unknown column type");

  const count = (await sql`
    select count(*)::int as n from table_columns where user_id = ${userId}::uuid
  `) as { n: number }[];
  if ((count[0]?.n ?? 0) >= MAX_CUSTOM_COLUMNS)
    throw new Error(`You can have up to ${MAX_CUSTOM_COLUMNS} custom columns.`);

  const rows = (await sql`
    insert into table_columns (user_id, name, kind)
    values (${userId}::uuid, ${name}, ${input.kind})
    returning id, name, kind, options
  `) as TableColumn[];
  return { ...rows[0], options: [] };
}

export async function renameColumn(id: string, name: string): Promise<void> {
  const userId = await requireUserId();
  const clean = cleanName(name);
  if (!UUID.test(id)) return;
  await sql`
    update table_columns set name = ${clean}
     where id = ${id}::uuid and user_id = ${userId}::uuid
  `;
}

/** Deletes the column and, by cascade, every value in it. */
export async function deleteColumn(id: string): Promise<void> {
  const userId = await requireUserId();
  if (!UUID.test(id)) return;
  await sql`
    delete from table_columns where id = ${id}::uuid and user_id = ${userId}::uuid
  `;
}

/** A select column's option list, replaced whole. */
export async function setColumnOptions(id: string, options: unknown): Promise<void> {
  const userId = await requireUserId();
  if (!UUID.test(id)) return;
  await sql`
    update table_columns set options = ${JSON.stringify(cleanOptions(options))}::jsonb
     where id = ${id}::uuid and user_id = ${userId}::uuid and kind = 'select'
  `;
}

/**
 * Sets one cell. A value that doesn't fit the column — including null or an
 * empty string — clears it instead.
 */
export async function setCellValue(
  todoId: string,
  columnId: string,
  value: unknown
): Promise<void> {
  const userId = await requireUserId();
  if (!UUID.test(todoId)) return;
  const column = await ownColumn(userId, columnId);
  if (!column) throw new Error("That column no longer exists");

  const clean = cleanValue(column, value);
  if (clean === undefined) {
    await sql`
      delete from todo_values
       where todo_id = ${todoId}::uuid and column_id = ${column.id}::uuid
         and user_id = ${userId}::uuid
    `;
    return;
  }

  // Joined against todos so a cell can only be written on one's own quest.
  await sql`
    insert into todo_values (todo_id, column_id, user_id, value)
    select t.id, ${column.id}::uuid, ${userId}::uuid, ${JSON.stringify(clean)}::jsonb
      from todos t
     where t.id = ${todoId}::uuid and t.user_id = ${userId}::uuid
    on conflict (todo_id, column_id) do update set value = excluded.value
  `;
}

/** Which columns show, in what order, how wide. */
export async function saveTableLayout(layout: TableLayout): Promise<void> {
  const userId = await requireUserId();
  await sql`
    update profiles set table_layout = ${JSON.stringify(cleanLayout(layout))}::jsonb
     where id = ${userId}::uuid
  `;
}
