import { useCallback, useEffect, useRef, useState } from 'react';

const ANNOUNCEMENT_MS = 8000;

/** The tester's status line: one message at a time, cleared once it has been on screen long enough to read. */
export function useAnnouncement(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);

  const announce = useCallback((next: string): void => {
    window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => setMessage(''), ANNOUNCEMENT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [message, announce];
}
