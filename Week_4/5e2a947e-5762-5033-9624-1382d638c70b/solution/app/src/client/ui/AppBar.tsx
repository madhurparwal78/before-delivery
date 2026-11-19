import type { ComponentChildren } from 'preact';
import { Logo } from './Logo.tsx';

/** The slim top bar of every non-home page: logo at the left, actions at the right. Not a `banner` on the home page, which has its own. */
export function AppBar({ children }: { children?: ComponentChildren }) {
  return (
    <header class="appbar">
      <div class="appbar-row">
        <Logo />
        <div class="appbar-actions">{children}</div>
      </div>
    </header>
  );
}
