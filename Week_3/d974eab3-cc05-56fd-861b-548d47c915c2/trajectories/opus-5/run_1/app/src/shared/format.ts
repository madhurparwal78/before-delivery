import type { Ingredient, Pack, Product } from './types';

/** Prices and amounts use thousands commas. */
export function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(?:\d{3})+(?!\d))/g, ',');
}

export function formatYen(priceYen: number): string {
  return `¥${groupDigits(priceYen)}`;
}

export function formatMilligrams(mg: number): string {
  return `${groupDigits(mg)} mg`;
}

export function ingredientAmount(ingredient: Ingredient): string {
  return formatMilligrams(ingredient.mg);
}

/** The Product chapter line. */
export function productLine(product: Product): string {
  return `${product.format}. ${product.serving}.`;
}

export function formatLine(product: Product): string {
  return `Format: ${product.format}`;
}

export function servingLine(product: Product): string {
  return `Serving: ${product.serving}`;
}

/** A Details tab pack line, also used on the product sheet. */
export function packLine(pack: Pack): string {
  return `${groupDigits(pack.sticks)} sticks: ${formatYen(pack.price_yen)} (tax included)`;
}

/** The store page names the product above the price. */
export function storePackLine(product: Product, pack: Pack): string {
  return `${product.name}, ${groupDigits(pack.sticks)} sticks`;
}

export function storePriceLine(pack: Pack): string {
  return `${formatYen(pack.price_yen)} (tax included)`;
}

export function storageLine(product: Product): string {
  return `Storage: ${product.storage}`;
}

export function notMedicineNotice(productName: string): string {
  return `${productName} is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.`;
}

export function editionLine(edition: number): string {
  return `Content edition ${edition}`;
}

export function sheetIngredientLine(ingredient: Ingredient): string {
  return `${ingredient.name} ${formatMilligrams(ingredient.mg)}`;
}

export function sheetStepLine(step: string, index: number): string {
  return `${index + 1}. ${step}`;
}
