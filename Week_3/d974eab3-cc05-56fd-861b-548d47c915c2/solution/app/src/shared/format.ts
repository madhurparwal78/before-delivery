import type { Ingredient, Pack, Product } from "./content.js";

export const INGREDIENTS_HEADING = "Ingredients per stick";
export const HOW_TO_USE_HEADING = "How to use";
export const CAUTIONS_HEADING = "Cautions";

function withCommas(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function priceLine(pack: Pack): string {
  return `¥${withCommas(pack.price_yen)} (tax included)`;
}

function packLine(pack: Pack): string {
  return `${pack.sticks} sticks: ${priceLine(pack)}`;
}

export function packHeading(product: Product, pack: Pack): string {
  return `${product.name}, ${pack.sticks} sticks`;
}

export function amount(ingredient: Ingredient): string {
  return `${withCommas(ingredient.mg)} mg`;
}

export function ingredientLine(ingredient: Ingredient): string {
  return `${ingredient.name} ${amount(ingredient)}`;
}

export function productLine(product: Product): string {
  return `${product.format}. ${product.serving}.`;
}

export function notice(product: Product): string {
  return `${product.name} is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.`;
}

export function editionLine(edition: number): string {
  return `Content edition ${edition}`;
}

function formatLine(product: Product): string {
  return `Format: ${product.format}`;
}

function servingLine(product: Product): string {
  return `Serving: ${product.serving}`;
}

export function storageLine(product: Product): string {
  return `Storage: ${product.storage}`;
}

/** Format, serving and one line per pack: the opening lines of the Details tab and of the product sheet. */
export function detailLines(product: Product): string[] {
  return [formatLine(product), servingLine(product), ...product.packs.map(packLine)];
}
