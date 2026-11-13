// A page drawn from several first loads stays unpainted (`.pending`, visibility hidden: it keeps its place but shows
// nothing) until each part has answered once, then appears whole, so nothing already on screen is pushed down as the
// parts arrive. A part that never answers cannot hold the page back past REVEAL_LIMIT_MS.
import { useState, useRef, useCallback, useEffect } from './html.js';

const REVEAL_LIMIT_MS = 3000;

export function useReveal(parts) {
  const [left, setLeft] = useState(parts);
  const seen = useRef(new Set());
  const done = useCallback((part) => {
    if (seen.current.has(part)) return;
    seen.current.add(part);
    setLeft((count) => count - 1);
  }, []);
  useEffect(() => {
    const limit = setTimeout(() => setLeft(0), REVEAL_LIMIT_MS);
    return () => clearTimeout(limit);
  }, []);
  return [left <= 0, done];
}
