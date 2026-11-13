export type ItemKind = "striker" | "board" | "coins";

interface ShopItem {
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
}

/** The shop catalogue from the seed data. Price-0 items belong to every player. */
export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "striker-ply", kind: "striker", name: "Plain Ply", price: 0 },
  { id: "striker-tomato", kind: "striker", name: "Tomato Lacquer", price: 120 },
  { id: "striker-cobalt", kind: "striker", name: "Cobalt Ring", price: 250 },
  { id: "striker-brass", kind: "striker", name: "Brass Inlay", price: 420 },
  { id: "board-ply", kind: "board", name: "Light Ply", price: 0 },
  { id: "board-chalk", kind: "board", name: "Chalk Line", price: 150 },
  { id: "board-walnut", kind: "board", name: "Walnut Night", price: 200 },
  { id: "coins-ivory", kind: "coins", name: "Ivory and Ink", price: 0 },
  { id: "coins-shell", kind: "coins", name: "Shell and Slate", price: 180 },
];

/** Price-0 items belong to every player. */
export function ownsByDefault(itemId: string): boolean {
  return SHOP_ITEMS.some((item) => item.id === itemId && item.price === 0);
}

export const BLOCKED_WORDS: readonly string[] = ["admin", "referee", "duecoin", "tamarind", "moderator"];

export const AVATAR_COUNT = 24;

