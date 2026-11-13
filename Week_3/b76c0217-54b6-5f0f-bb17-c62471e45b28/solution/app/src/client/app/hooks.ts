import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EditorEvents } from '../../server/events';
import { follow } from '../shared/stream';

// Effects here run synchronously after a commit (useLayoutEffect): Preact's useEffect waits for an animation
// frame, which never comes while a page clock is paused.

type Handlers = { [K in keyof EditorEvents]?: (data: EditorEvents[K]) => void };

/** Follow the live event stream of a version, a page, or the whole team. Handlers may change between renders. */
export function useEventStream(query: string, handlers: Handlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useLayoutEffect(() => {
    return follow(`/api/events${query}`, (name, data) => {
      const handler = latest.current[name as keyof EditorEvents] as ((data: unknown) => void) | undefined;
      handler?.(data);
    });
  }, [query]);
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useLayoutEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    list.addEventListener('change', update);
    update();
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
