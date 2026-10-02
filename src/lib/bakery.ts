/* --------------------------------------------------------------------------
   The village bakery's treats. Bought for coins at its counter (Village.tsx,
   BakeryPanel) and sent to a companion's door, where they arrive with a note
   (door_notes.treat). The server charges for them (village-actions.ts,
   sendTreat); coins are the store's (src/lib/shop.ts).
   -------------------------------------------------------------------------- */

export type TreatId = "loaf" | "croissant" | "bun" | "cupcake" | "pie" | "cake";

export type Treat = {
  id: TreatId;
  name: string;
  /** "a croissant", for "Sol sent you a croissant". */
  a: string;
  blurb: string;
  price: number;
};

export const TREATS: Treat[] = [
  { id: "loaf", name: "Country loaf", a: "a country loaf", blurb: "Crusty, still warm. Good for any day.", price: 5 },
  { id: "croissant", name: "Butter croissant", a: "a croissant", blurb: "For a morning that needs a push.", price: 8 },
  { id: "bun", name: "Cinnamon bun", a: "a cinnamon bun", blurb: "Sticky and sweet, for a long afternoon.", price: 10 },
  { id: "cupcake", name: "Cupcake", a: "a cupcake", blurb: "A little well done for a little win.", price: 12 },
  { id: "pie", name: "Berry pie", a: "a berry pie", blurb: "A whole pie, for finishing something big.", price: 20 },
  { id: "cake", name: "Celebration cake", a: "a celebration cake", blurb: "Candles and all. For streaks and level-ups.", price: 40 },
];

export const treatById = (id: unknown) => TREATS.find((t) => t.id === id) ?? null;
