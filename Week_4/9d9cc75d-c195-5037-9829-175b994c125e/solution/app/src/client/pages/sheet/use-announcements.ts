import { useCallback, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * The text of `status "View announcements"`. Announcing the same sentence twice empties the region first, so a
 * screen reader hears it again.
 */
export function useAnnouncements(): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const announce = useCallback((next: string) => {
    flushSync(() => setText(''));
    flushSync(() => setText(next));
  }, []);
  return [text, announce];
}
