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
 * (village.ts ROOFS), "wall:…" a wallpaper, "floor:…" a floor and
 * "furniture:…" a piece of furniture (furniture.ts). A freeze is used up
 * instead (profiles.bonus_freezes).
 */
export type Good = {
  id: string;
  name: string;
  blurb: string;
  price: number;
  kind: "freeze" | "roof" | "wall" | "floor" | "furniture";
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
  { id: "roof:copper", name: "Verdigris copper roof", blurb: "Old copper gone sea-green, like a chapel spire.", price: 70, kind: "roof", color: "#5fa391" },
  { id: "roof:blossom", name: "Blossom roof", blurb: "Pink as an orchard in April.", price: 60, kind: "roof", color: "#e08aa4" },
  { id: "roof:amethyst", name: "Amethyst roof", blurb: "A wizard's purple. Pointy hat not included.", price: 70, kind: "roof", color: "#6a4fb0" },
  { id: "wall:starry", name: "Starry night wallpaper", blurb: "Gold stars on deep blue, for the inside of your house.", price: 50, kind: "wall", color: "#2c3a66" },
  { id: "wall:ivy", name: "Ivy trellis wallpaper", blurb: "A garden that climbs the walls.", price: 40, kind: "wall", color: "#a9c27f" },
  { id: "wall:damask", name: "Rose damask wallpaper", blurb: "Deep red with a pale pattern, very grand.", price: 50, kind: "wall", color: "#7a2a3a" },
  { id: "wall:gilded", name: "Gilded panel wallpaper", blurb: "Dark wood picked out in gold.", price: 70, kind: "wall", color: "#3a2a1c" },
  { id: "floor:marble", name: "Marble floor", blurb: "Cool, pale and polished.", price: 50, kind: "floor", color: "#e8e3da" },
  { id: "floor:cherry", name: "Cherry wood floor", blurb: "Warm red boards.", price: 40, kind: "floor", color: "#a8503a" },
  { id: "floor:bluetile", name: "Blue tile floor", blurb: "Blue and white squares, like a seaside kitchen.", price: 50, kind: "floor", color: "#3a6aa8" },
  { id: "floor:straw", name: "Woven straw floor", blurb: "Soft underfoot and smells of summer.", price: 30, kind: "floor", color: "#e3c27a" },
  { id: "furniture:piano", name: "Piano", blurb: "An upright piano for the corner. Plays itself in your head.", price: 120, kind: "furniture", color: "#2a1d16" },
  { id: "furniture:aquarium", name: "Aquarium", blurb: "Two goldfish who are very busy.", price: 90, kind: "furniture", color: "#7fc4e0" },
  { id: "furniture:telescope", name: "Telescope", blurb: "Brass, on a tripod, for looking at stars and neighbours.", price: 70, kind: "furniture", color: "#c9a24a" },
  { id: "furniture:stainedglass", name: "Stained glass window", blurb: "Red, blue and gold, for the back wall.", price: 60, kind: "furniture", color: "#c0392b" },
];

/** The store's shelves, in the order they're shown. */
export const SECTIONS: { kind: Good["kind"]; label: string }[] = [
  { kind: "freeze", label: "Useful" },
  { kind: "roof", label: "Roofs" },
  { kind: "wall", label: "Wallpaper" },
  { kind: "floor", label: "Floors" },
  { kind: "furniture", label: "Furniture" },
];

/** Goods for real money. None yet: the counter is there, closed, until payments are set up. */
export const MONEY_GOODS: Good[] = [];

export const goodById = (id: string) => COIN_GOODS.find((g) => g.id === id) ?? null;
