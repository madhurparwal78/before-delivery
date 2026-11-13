// Incident numbers to ids. The API lists incidents by status; a number is found by paging through the list.
import { useState, useEffect } from '../../lib/html.js';
import { api } from '../../lib/api.js';

const PAGE = 100;
const MAX_PAGES = 30;

// findIncidents pages through the list of one status until every wanted number is found.
// It returns a Map of number -> incident id for the numbers that exist in that status.
export async function findIncidents(status, numbers) {
  const wanted = new Set(numbers);
  const found = new Map();
  let after = null;
  for (let page = 0; page < MAX_PAGES && found.size < wanted.size; page += 1) {
    const query = `status=${status}&limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const res = await api.get(`/api/incidents?${query}`);
    if (!res.ok) break;
    for (const item of res.data.items) if (wanted.has(item.number)) found.set(item.number, item.id);
    after = res.data.next_cursor;
    if (!after) break;
  }
  return found;
}

// useMergeTarget is the id of the incident a merged source was folded into, once it is found.
export function useMergeTarget(number) {
  const [id, setId] = useState(null);
  useEffect(() => {
    let live = true;
    findIncidents('all', [number]).then((found) => {
      if (live) setId(found.get(number) ?? null);
    });
    return () => { live = false; };
  }, [number]);
  return id;
}
