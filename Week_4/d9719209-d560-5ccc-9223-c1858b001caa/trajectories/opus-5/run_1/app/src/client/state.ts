import type { PageData } from '../shared/types.js';

function readPageData(): PageData {
  const node = document.getElementById('page-data');
  if (!node || !node.textContent) return { route: 'unknown', account: null, topics: [] };
  return JSON.parse(node.textContent) as PageData;
}

export const page: PageData = readPageData();

export function isSignedIn(): boolean {
  return page.account !== null;
}

