import { useLayoutEffect, useRef, useState } from 'react';
import { play } from '../lib/motion.js';
import type { Message } from '../lib/workspace.js';
import { CloseIcon } from './Icons.js';

const STAYS_MS = 8000;

/** The "Editor notice" alert: a notice slides down, stays 8 seconds, then slides away; it can be dismissed early. */
export function NoticeArea({ notice }: { notice: Message | null }) {
  const [dismissed, setDismissed] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const visible = notice !== null && notice.id !== dismissed;
  const id = notice?.id;

  const leave = (): void => {
    if (box.current && id !== undefined) play(box.current, 'notice', [{ transform: 'translateY(0)' }, { transform: 'translateY(-110%)' }], () => setDismissed(id));
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useLayoutEffect(() => {
    if (!box.current || id === undefined || id === dismissed) return;
    play(box.current, 'notice', [{ transform: 'translateY(-110%)' }, { transform: 'translateY(0)' }]);
    const timer = window.setTimeout(() => leaveRef.current(), STAYS_MS);
    return () => window.clearTimeout(timer);
  }, [id]);

  return (
    <div role="alert" aria-label="Editor notice" className="notice-region">
      {visible && (
        <div className="notice" ref={box}>
          <span>{notice.text}</span>
          <button type="button" className="icon-button" aria-label="Dismiss notice" onClick={leave}>
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}
