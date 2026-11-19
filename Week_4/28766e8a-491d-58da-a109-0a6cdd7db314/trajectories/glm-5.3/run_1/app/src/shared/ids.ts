import type { Role, Shape, ShapeKind, PortName, Page, Document, Layer } from './model.js';

export const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type IdPrefix = 'd' | 'p' | 'l' | 's' | 'c' | 'g' | 'm' | 'v' | 'x' | 'i' | 'u';

export function makeId(prefix: IdPrefix, rand: () => number): string {
  let tail = '';
  for (let i = 0; i < 12; i++) {
    tail += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)];
  }
  return `${prefix}_${tail}`;
}

export const ID_PATTERN = /^[dplscgmvxiu]_[a-z0-9]{12}$/;
export const OP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** True when text contains CR, LF, another C0 control character or DEL. */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

export function isWholeNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function shapeLabel(shape: { label: string; kind: ShapeKind }): string {
  return shape.label.length === 0 ? `Untitled ${shape.kind}` : shape.label;
}

export function shapeById(page: Page, id: string): Shape | undefined {
  return page.shapes.find((s) => s.id === id);
}

export function pageById(doc: Document, id: string): Page | undefined {
  return doc.pages.find((p) => p.id === id);
}

export function layerById(page: Page, id: string): Layer | undefined {
  return page.layers.find((l) => l.id === id);
}

export function roleCanEdit(role: Role): boolean {
  return role === 'owner' || role === 'editor';
}

export function sortedByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function orderedLayers(page: Page): Layer[] {
  return sortedByOrder(page.layers);
}

export function orderedPages(doc: Document): Page[] {
  return sortedByOrder(doc.pages);
}

export function layerOfShape(page: Page, shape: Shape): Layer | undefined {
  return page.layers.find((l) => l.id === shape.layer);
}

export const PORT_NAMES: PortName[] = ['n', 'e', 's', 'w'];
