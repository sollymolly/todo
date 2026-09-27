import { COLOR_KEYS } from "./game";

/* --------------------------------------------------------------------------
   The table view's columns: the built-in ones every quest has, and the
   custom ones a person adds themselves (migration 023) — Notion's
   "properties".

   Shared by the browser and the server, so a layout or a value is checked by
   the same rules on both sides. Nothing here touches the database.
   -------------------------------------------------------------------------- */

export type ColumnKind = "text" | "number" | "checkbox" | "select" | "date";

export const KINDS: { kind: ColumnKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "checkbox", label: "Checkbox" },
  { kind: "select", label: "Select" },
  { kind: "date", label: "Date" },
];

export type SelectOption = { id: string; label: string; color: string };

/** A custom column's definition. Its values live apart, per quest. */
export type TableColumn = {
  id: string;
  name: string;
  kind: ColumnKind;
  options: SelectOption[];
};

/** What a custom cell can hold, by kind. A missing value is simply absent. */
export type CellValue = string | number | boolean;

/** Every quest's custom values: todo id → column id → value. */
export type ColumnValues = Record<string, Record<string, CellValue>>;

/* ---------------------------------------------------------------- built-in */

export type BuiltinKey =
  | "title"
  | "category"
  | "due"
  | "status"
  | "xp"
  | "created"
  | "notes"
  | "steps"
  | "completed";

export const BUILTINS: { key: BuiltinKey; label: string; width: number }[] = [
  { key: "title", label: "Name", width: 320 },
  { key: "category", label: "Category", width: 150 },
  { key: "due", label: "Due", width: 170 },
  { key: "status", label: "Status", width: 110 },
  { key: "xp", label: "XP", width: 80 },
  { key: "created", label: "Created", width: 100 },
  { key: "notes", label: "Notes", width: 240 },
  { key: "steps", label: "Steps", width: 90 },
  { key: "completed", label: "Completed", width: 120 },
];

/** Name is the row's identity — like Notion's title property, it can't go. */
export const LOCKED: ReadonlySet<string> = new Set(["title"]);

/* ------------------------------------------------------------------ layout */

/**
 * Which columns show, in what order, how wide. A built-in by its key, a
 * custom column as "custom:<id>". Anything not listed is hidden.
 */
export type LayoutColumn = { key: string; width: number };
export type TableLayout = { columns: LayoutColumn[] };

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 800;
export const DEFAULT_CUSTOM_WIDTH = 160;
export const MAX_CUSTOM_COLUMNS = 20;

export const DEFAULT_LAYOUT: TableLayout = {
  columns: BUILTINS.filter((b) =>
    ["title", "category", "due", "status", "xp", "created"].includes(b.key)
  ).map((b) => ({ key: b.key, width: b.width })),
};

export const customKey = (id: string) => `custom:${id}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUILTIN_KEYS = new Set<string>(BUILTINS.map((b) => b.key));

export const clampWidth = (w: number) =>
  Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number.isFinite(w) ? w : 150)));

/**
 * A layout made safe to store or render: known keys only, no repeats, sane
 * widths, and Name always first. Anything else a client sends is dropped.
 */
export function cleanLayout(raw: unknown): TableLayout {
  const list = (raw as { columns?: unknown })?.columns;
  if (!Array.isArray(list)) return DEFAULT_LAYOUT;

  const seen = new Set<string>();
  const columns: LayoutColumn[] = [];
  for (const c of list.slice(0, 60)) {
    const key = (c as { key?: unknown })?.key;
    if (typeof key !== "string" || seen.has(key)) continue;
    const ok = BUILTIN_KEYS.has(key) || (key.startsWith("custom:") && UUID.test(key.slice(7)));
    if (!ok) continue;
    seen.add(key);
    columns.push({ key, width: clampWidth(Number((c as { width?: unknown }).width)) });
  }

  if (!seen.has("title")) columns.unshift({ key: "title", width: BUILTINS[0].width });
  else columns.sort((a, b) => (a.key === "title" ? -1 : b.key === "title" ? 1 : 0));
  return { columns };
}

/* ------------------------------------------------------------------ values */

const OPTION_ID = /^[a-z0-9]{1,12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Select options made safe to store: short labels, known colours, no repeats. */
export function cleanOptions(raw: unknown): SelectOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of raw.slice(0, 50)) {
    const r = o as Partial<SelectOption>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
    if (!label || typeof r.id !== "string" || !OPTION_ID.test(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      label,
      color: typeof r.color === "string" && COLOR_KEYS.includes(r.color) ? r.color : "amber",
    });
  }
  return out;
}

/**
 * A value checked against its column's kind, or undefined if it doesn't fit —
 * which the caller treats as "clear the cell".
 */
export function cleanValue(column: TableColumn, value: unknown): CellValue | undefined {
  switch (column.kind) {
    case "text":
      return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : undefined;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "checkbox":
      return value === true ? true : undefined;
    case "select":
      return typeof value === "string" && column.options.some((o) => o.id === value)
        ? value
        : undefined;
    case "date": {
      if (typeof value !== "string" || !DATE.test(value)) return undefined;
      const d = new Date(`${value}T00:00:00Z`);
      return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : undefined;
    }
  }
}

/** A short random id for a new select option. */
export function optionId(): string {
  return Math.random().toString(36).slice(2, 10);
}
