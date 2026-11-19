// Literal, bounded search where the latest answer always wins: an answer for
// earlier text is discarded whenever it arrives.

import * as api from '../api.js';

export const MIN_QUERY = 2;
export const MAX_QUERY = 100;
export const DEBOUNCE_MS = 250;

export function createSearcher(onResult) {
  let latestText = '';
  let timer = null;

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function run(raw) {
    const text = String(raw).trim();
    latestText = text;
    cancel();
    if ([...text].length < MIN_QUERY || [...text].length > MAX_QUERY) {
      onResult({ text, pending: false, result: null });
      return;
    }
    onResult({ text, pending: true, result: null });
    timer = setTimeout(async () => {
      const asked = text;
      const answer = await api.get(`/api/search?q=${encodeURIComponent(asked)}`);
      // Any answer for earlier text is discarded, whenever it arrives.
      if (asked !== latestText) return;
      if (answer.status !== 200) {
        onResult({ text: asked, pending: false, result: null, failed: true });
        return;
      }
      onResult({ text: asked, pending: false, result: answer.json });
    }, DEBOUNCE_MS);
  }

  return { run, cancel, current: () => latestText };
}

// The one literal, case-insensitive containment rule the page uses for its own
// matches, such as cockpit page names.
export function literalMatch(haystack, needle) {
  return String(haystack).toLowerCase().includes(String(needle).trim().toLowerCase());
}
