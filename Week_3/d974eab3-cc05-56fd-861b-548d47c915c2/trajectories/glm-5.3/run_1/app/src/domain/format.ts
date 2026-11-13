import type { Product } from './content.js';

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatYen(value: number): string {
  return `¥${formatNumber(value)}`;
}

export function packLine(sticks: number, priceYen: number): string {
  return `${sticks} sticks: ${formatYen(priceYen)} (tax included)`;
}

export function ingredientAmount(mg: number): string {
  return `${formatNumber(mg)} mg`;
}

export function notAMedicine(product: Pick<Product, 'name'>): string {
  return `${product.name} is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.`;
}

export function editionLine(edition: number): string {
  return `Content edition ${edition}`;
}

export function productLine(product: Product): string {
  return `${product.format}. ${product.serving}.`;
}
