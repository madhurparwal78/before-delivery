import { useRef } from 'react';
import type { Notice } from '../../shared/types.js';
import { gold2 } from '../../shared/format.js';
import { useGrowIn } from '../motion.js';
import { Dialog } from './Dialog.js';

function openerRow(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('li[tabindex]')) return active;
  return document.querySelector<HTMLElement>('[data-list="habits"] li[tabindex]');
}

/** The level-up and faint dialogs, live or waiting from a close. */
export function NoticeDialog({ notice, onClose }: { notice: Notice; onClose: () => void }): JSX.Element {
  const returnTo = useRef<HTMLElement | null>(openerRow());
  const grow = useGrowIn(500);

  if (notice.kind === 'level_up') {
    return (
      <Dialog name="Level up" onClose={onClose} centred returnFocusTo={() => returnTo.current}>
        <h2 className="dialog-title">Level up</h2>
        <svg
          className="level-badge"
          role="img"
          aria-label={`Level ${notice.level} badge`}
          viewBox="0 0 120 120"
          ref={grow}
        >
          <rect x="0" y="0" width="120" height="120" />
          <text x="60" y="76" textAnchor="middle">
            {notice.level}
          </text>
        </svg>
        <p>{`You reached level ${notice.level}. Your health is full again.`}</p>
        <div className="dialog-actions">
          <button type="button" className="strong" onClick={onClose}>
            Keep going
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog name="You fainted" onClose={onClose} centred returnFocusTo={() => returnTo.current}>
      <h2 className="dialog-title">You fainted</h2>
      <p>{`You dropped to level ${notice.level} and lost ${gold2(notice.goldLost)} gold. Your health is back to 50.0.`}</p>
      <div className="dialog-actions">
        <button type="button" className="strong" onClick={onClose}>
          Get back up
        </button>
      </div>
    </Dialog>
  );
}
