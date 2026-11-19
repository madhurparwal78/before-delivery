import type { ReactNode } from 'react';

// One consistent, original icon set: 24px grid, 1.75px stroke, round caps, drawn for Slatehall.
const PATHS = {
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V4.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v6.5a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4.5 14a1.5 1.5 0 0 1 2.4-1.8L8 13.5" />,
  poll: <path d="M5 20V10m7 10V4m7 16v-7" />,
  tables: <path d="M4 8h16M6 8v10m12-10v10M9 12h6" />,
  chat: <path d="M4 5h16v11H9l-5 4V5Z" />,
  seat: <path d="M7 4h10v8H7zM6 12h12v3H6zM8 15v5m8-5v5" />,
  lock: <path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  slides: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
  file: <path d="M7 3h7l4 4v14H7zM14 3v4h4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  warning: <path d="M12 4 3 20h18L12 4Zm0 6v5m0 3v.01" />,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  arrowUp: <path d="M12 19V6m-6 6 6-6 6 6" />,
  arrowDown: <path d="M12 5v13m-6-6 6 6 6-6" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

/** Small line drawings for empty states: an empty chalk tray, a quill and a seat row. */
export function EmptyDrawing({ kind, size = 72 }: { kind: 'tray' | 'quill' | 'seats'; size?: number }) {
  return (
    <svg className="drawing" width={size} height={size} viewBox="0 0 72 72" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {kind === 'tray' && <path d="M8 46h56l-5 10H13L8 46Zm6-6h44M18 40V24h36v16M26 32h10" />}
      {kind === 'quill' && <path d="M58 10C40 12 26 26 22 46l-8 14m8-14c10 2 22-4 28-16M30 40l16-14" />}
      {kind === 'seats' && <path d="M10 56V32h14v24M10 44h14M30 56V32h14v24M30 44h14M50 56V32h14v24M50 44h14M6 58h60" />}
    </svg>
  );
}
