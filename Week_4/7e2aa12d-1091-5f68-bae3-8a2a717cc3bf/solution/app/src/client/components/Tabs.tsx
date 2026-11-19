import type { KeyboardEvent } from 'react';

/** Left and Right move focus between the tabs of a tablist; Enter or Space then selects the focused tab. */
export function useTabKeys(): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')];
    const at = tabs.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    tabs[(at + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].focus();
  };
}
