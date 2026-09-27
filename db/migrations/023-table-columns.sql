-- ===========================================================================
--  Migration 023 — custom columns in the table view
--
--  Run once in the Neon SQL Editor. Safe to re-run.
--
--  THE MODEL
--  ---------
--  Like Notion properties. A person defines columns of their own — a name and
--  a kind (text, number, checkbox, select, date) — and fills them in per
--  quest. Definitions and values are two tables so a column can be renamed,
--  or given new select options, without touching every quest that uses it.
--
--  Values are jsonb, checked against the column's kind in the app before
--  they're written (src/lib/table-columns.ts). Deleting a column deletes its
--  values; deleting a quest — including the 7-day prune of finished ones —
--  deletes its values too, by cascade.
--
--  The table's layout — which columns show, in what order, how wide — is one
--  jsonb document on the profile, so it follows the account between devices.
--  Null means the default layout.
-- ===========================================================================

create table if not exists table_columns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  name        text not null check (length(name) between 1 and 40),
  kind        text not null check (kind in ('text', 'number', 'checkbox', 'select', 'date')),
  /* For select columns: [{ "id", "label", "color" }]. Empty otherwise. */
  options     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists table_columns_user_idx on table_columns(user_id);

create table if not exists todo_values (
  todo_id    uuid not null references todos(id) on delete cascade,
  column_id  uuid not null references table_columns(id) on delete cascade,
  /* Denormalised owner, so every read and write can be scoped by it. */
  user_id    uuid not null references users(id) on delete cascade,
  value      jsonb not null,
  primary key (todo_id, column_id)
);

create index if not exists todo_values_user_idx on todo_values(user_id);

alter table profiles add column if not exists table_layout jsonb;
