import { useEffect, useRef, useState } from 'react';
import { copy } from './copy';
import type { Transport } from './roomLink';

/** Connection copy: silent until the link degrades, then says where it stands. */
export function useConnectionCopy(transport: Transport): string {
  const [text, setText] = useState('');
  const degraded = useRef(false);

  useEffect(() => {
    if (transport === 'backup') {
      degraded.current = true;
      setText(copy.backupLink);
      return;
    }
    if (transport === 'reconnecting') {
      degraded.current = true;
      setText(copy.reconnecting);
      return;
    }
    if (transport === 'live') {
      setText(degraded.current ? copy.backOnLive : '');
    }
  }, [transport]);

  return text;
}
