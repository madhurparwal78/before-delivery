import { useEffect, useRef, useState, useCallback } from 'react';
import type { LiveEvent } from './api';

export function useAnnouncement(): { announce: (line: string) => void; line: string } {
  const [line, setLine] = useState('');
  const announce = useCallback((next: string) => {
    setLine(next);
  }, []);
  return { announce, line };
}

export function AnnouncementRegion({ line }: { line: string }): React.ReactNode {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">
      {line}
    </div>
  );
}

/** One subscription per screen; every open screen receives its own events. */
export function useLiveEvents(onEvent: (event: LiveEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as LiveEvent;
      handler.current(parsed);
    };
    return () => source.close();
  }, []);
}
