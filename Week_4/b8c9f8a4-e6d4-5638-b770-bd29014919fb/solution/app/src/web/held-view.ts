// The inspector's last view, kept on the device so the capture screen still works with no
// signal. It holds only what this link may already see.

import type { LinkView } from './types.js';

const KEY = 'open-bonnet-view:';

export function keepView(token: string, view: LinkView): void {
  try {
    localStorage.setItem(KEY + token, JSON.stringify(view));
  } catch {
    // a device that refuses storage simply has no offline copy
  }
}

export function lastView(token: string): LinkView | null {
  try {
    const held = localStorage.getItem(KEY + token);
    return held ? (JSON.parse(held) as LinkView) : null;
  } catch {
    return null;
  }
}
