import type { Page, PlinthDocument, PlinthNode } from './types.js';
import { BREAKPOINTS } from './types.js';
import { allNodes, linkedInstances } from './tree.js';

function nodeTokenUses(node: PlinthNode, name: string): number {
  let uses = 0;
  for (const bp of BREAKPOINTS) {
    for (const value of Object.values(node.styles[bp])) {
      if (value !== undefined && typeof value !== 'string' && value.token === name) uses += 1;
    }
  }
  return uses;
}

/** One use is one style value referencing the token. Component styles count once. */
export function countTokenUses(doc: PlinthDocument, name: string): number {
  let uses = 0;
  const instanceIds = new Set<string>();
  for (const component of doc.components) {
    for (const node of allNodes(component.root)) uses += nodeTokenUses(node, name);
    for (const instance of linkedInstances(doc, component.id)) {
      for (const node of allNodes(instance)) instanceIds.add(node.id);
    }
  }
  for (const page of doc.pages) {
    for (const node of allNodes(page.root)) {
      if (instanceIds.has(node.id)) continue;
      uses += nodeTokenUses(node, name);
    }
  }
  return uses;
}

export function countFieldBindings(doc: PlinthDocument, field: string): number {
  let count = 0;
  for (const page of doc.pages) {
    for (const node of allNodes(page.root)) {
      for (const bound of Object.values(node.bind ?? {})) if (bound === field) count += 1;
    }
  }
  for (const component of doc.components) {
    for (const node of allNodes(component.root)) {
      for (const bound of Object.values(node.bind ?? {})) if (bound === field) count += 1;
    }
  }
  return count;
}

export function pageUsesToken(doc: PlinthDocument, page: Page, name: string): boolean {
  const nodes = allNodes(page.root);
  if (nodes.some((node) => nodeTokenUses(node, name) > 0)) return true;
  for (const node of nodes) {
    if (!node.shared) continue;
    const component = doc.components.find((c) => c.id === node.shared!.componentId);
    if (component && allNodes(component.root).some((n) => nodeTokenUses(n, name) > 0)) return true;
  }
  return false;
}

export function pageHasCollectionList(page: Page): boolean {
  return allNodes(page.root).some((node) => node.type === 'collection_list');
}

