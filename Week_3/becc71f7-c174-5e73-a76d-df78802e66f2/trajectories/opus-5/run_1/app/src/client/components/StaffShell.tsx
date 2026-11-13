import type { ComponentChildren } from 'preact';
import type { Session } from '../lib/types.js';
import { useLocation } from '../lib/router.js';
import { StaffTopBar } from './chrome.js';

interface StaffShellProps {
  session: Session;
  /** A list screen pairs one wide table with a narrow detail column. */
  layout?: 'plain' | 'split';
  children: ComponentChildren;
}

export function StaffShell({ session, layout = 'plain', children }: StaffShellProps) {
  const location = useLocation();
  return (
    <div class="screen screen--staff">
      <StaffTopBar session={session} current={location.pathname} />
      <main class={`screen__main staff-main staff-main--${layout}`}>{children}</main>
    </div>
  );
}
