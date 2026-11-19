import type { AssetRecord, VariantRecord } from './records.js';

export interface Card {
  assetId: string;
  variantId: string | null;
  cardName: string;
  asset: AssetRecord;
  variant: VariantRecord | null;
}

export function cardNameFor(asset: AssetRecord, variant: VariantRecord | null): string {
  return variant ? `${asset.name} — ${variant.label}` : asset.name;
}

/** Every card the library can show: one per variant, or one per asset without variants. */
export function buildCards(assets: AssetRecord[], variants: VariantRecord[]): Card[] {
  const cards: Card[] = [];
  for (const asset of assets) {
    if (asset.state === 'draft') continue;
    const own = variants.filter((variant) => variant.assetId === asset.id).sort((a, b) => a.sort - b.sort);
    if (own.length === 0) {
      cards.push({ assetId: asset.id, variantId: null, cardName: asset.name, asset, variant: null });
    } else {
      for (const variant of own) {
        cards.push({
          assetId: asset.id,
          variantId: variant.id,
          cardName: cardNameFor(asset, variant),
          asset,
          variant,
        });
      }
    }
  }
  return cards.sort((left, right) => (left.cardName < right.cardName ? -1 : left.cardName > right.cardName ? 1 : 0));
}
