/* --------------------------------------------------------------------------
   The village store's goods. Shared by the store's counter (Village.tsx,
   ShopPanel) and the server, which charges for them (village-actions.ts,
   buyGood).

   Coins are earned as XP is: one for every ten, from quests, habits and
   focus time alike. A balance is never stored, only what's been spent
   (profiles.coins_spent), so there's nothing to keep in step with XP.

   Two counters: goods for coins, and goods for real money — that one
   stays shut for now (MONEY_GOODS is empty) until payments are set up.
   -------------------------------------------------------------------------- */

export const XP_PER_COIN = 10;

/** What I have to spend: coins earned from my XP, less what I've spent. */
export function coinsLeft(xp: number, spent: number): number {
  return Math.max(0, Math.floor(xp / XP_PER_COIN) - spent);
}

/**
 * Something for sale. `id` for keeps is what's recorded in `purchases`, and
 * names the thing it unlocks: "roof:gold" is the roof colour "gold"
 * (village.ts ROOFS), "wall:…" a wallpaper and "floor:…" a floor
 * (furniture.ts). A freeze is used up instead (profiles.bonus_freezes).
 */
export type Good = {
  id: string;
  name: string;
  blurb: string;
  price: number;
  kind: "freeze" | "roof" | "wall" | "floor";
  /** A swatch for the counter. */
  color: string;
};

export const COIN_GOODS: Good[] = [
  {
    id: "freeze",
    name: "Streak freeze",
    blurb: "Covers a missed habit day once this month's two are gone. Keeps until you need it.",
    price: 30,
    kind: "freeze",
    color: "#7cc4f0",
  },
  { id: "roof:gold", name: "Gold leaf roof", blurb: "For a house that wants to be noticed.", price: 80, kind: "roof", color: "#d9a92e" },
  { id: "roof:royal", name: "Royal blue roof", blurb: "Deep blue, like a herald's banner.", price: 60, kind: "roof", color: "#2f4fa3" },
  { id: "wall:starry", name: "Starry night wallpaper", blurb: "Gold stars on deep blue, for the inside of your house.", price: 50, kind: "wall", color: "#2c3a66" },
  { id: "floor:marble", name: "Marble floor", blurb: "Cool, pale and polished.", price: 50, kind: "floor", color: "#e8e3da" },
];

/** Goods for real money. None yet: the counter is there, closed, until payments are set up. */
export const MONEY_GOODS: Good[] = [];

export const goodById = (id: string) => COIN_GOODS.find((g) => g.id === id) ?? null;
