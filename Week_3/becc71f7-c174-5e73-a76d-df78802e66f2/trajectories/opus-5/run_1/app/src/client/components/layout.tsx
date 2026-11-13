import type { ComponentChildren } from 'preact';
import { go } from '../lib/router.js';

interface LinkProps {
  href: string;
  children: ComponentChildren;
  class?: string;
  ariaCurrent?: 'page' | 'true';
}

/** An in-app link: a real anchor, followed without a reload. */
export function Link({ href, children, class: className, ariaCurrent }: LinkProps) {
  return (
    <a
      href={href}
      {...(className === undefined ? {} : { class: className })}
      {...(ariaCurrent === undefined ? {} : { 'aria-current': ariaCurrent })}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        go(href);
      }}
    >
      {children}
    </a>
  );
}

/**
 * SR5: a wide table at 375 scrolls sideways inside its own frame, and that frame takes
 * keyboard focus and has an accessible name.
 */
export function TableFrame({ name, children }: { name: string; children: ComponentChildren }) {
  return (
    <div class="table-frame" role="region" aria-label={`${name} table`} tabIndex={0}>
      {children}
    </div>
  );
}

/** SR6: at 375x812 each screen's main action sits in a bar fixed to the bottom. */
export function BottomBar({ children }: { children: ComponentChildren }) {
  return <div class="bottom-bar">{children}</div>;
}
