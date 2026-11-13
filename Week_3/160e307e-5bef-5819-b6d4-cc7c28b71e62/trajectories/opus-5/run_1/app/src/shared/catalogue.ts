export type ItemKind = 'striker' | 'board' | 'coins';

export interface CatalogueItem {
  id: string;
  kind: ItemKind;
  name: string;
  price: number;
}

export const CATALOGUE: CatalogueItem[] = [
  { id: 'striker-ply', kind: 'striker', name: 'Plain Ply', price: 0 },
  { id: 'striker-tomato', kind: 'striker', name: 'Tomato Lacquer', price: 120 },
  { id: 'striker-cobalt', kind: 'striker', name: 'Cobalt Ring', price: 250 },
  { id: 'striker-brass', kind: 'striker', name: 'Brass Inlay', price: 420 },
  { id: 'board-ply', kind: 'board', name: 'Light Ply', price: 0 },
  { id: 'board-chalk', kind: 'board', name: 'Chalk Line', price: 150 },
  { id: 'board-walnut', kind: 'board', name: 'Walnut Night', price: 200 },
  { id: 'coins-ivory', kind: 'coins', name: 'Ivory and Ink', price: 0 },
  { id: 'coins-shell', kind: 'coins', name: 'Shell and Slate', price: 180 },
];

export const KIND_TABS: { kind: ItemKind; label: string }[] = [
  { kind: 'striker', label: 'Strikers' },
  { kind: 'board', label: 'Boards' },
  { kind: 'coins', label: 'Coin sets' },
];

export const FREE_ITEM_IDS = CATALOGUE.filter((item) => item.price === 0).map((item) => item.id);

export const DEFAULT_EQUIPPED = {
  striker: 'striker-ply',
  board: 'board-ply',
  coins: 'coins-ivory',
};

export function itemById(id: string): CatalogueItem | undefined {
  return CATALOGUE.find((item) => item.id === id);
}
