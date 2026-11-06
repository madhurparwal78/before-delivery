// Lucide icons 1.64.0 (ISC licence), path data copied from lucide-static. Always decorative: the
// control that holds an icon carries the words.
import type { JSX } from "preact";

const ICONS = {
  upload: [<path d="M12 3v12" />, <path d="m17 8-5-5-5 5" />, <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />],
  "trash-2": [
    <path d="M10 11v6" />,
    <path d="M14 11v6" />,
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />,
    <path d="M3 6h18" />,
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  ],
  link: [
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />,
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />,
  ],
  x: [<path d="M18 6 6 18" />, <path d="m6 6 12 12" />],
  menu: [<path d="M4 5h16" />, <path d="M4 12h16" />, <path d="M4 19h16" />],
  download: [<path d="M12 15V3" />, <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />, <path d="m7 10 5 5 5-5" />],
  "rotate-ccw": [<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />, <path d="M3 3v5h5" />],
  folder: [
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  ],
  file: [
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />,
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />,
  ],
  search: [<path d="m21 21-4.34-4.34" />, <circle cx="11" cy="11" r="8" />],
  "log-out": [<path d="m16 17 5-5-5-5" />, <path d="M21 12H9" />, <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />],
  plus: [<path d="M5 12h14" />, <path d="M12 5v14" />],
  "chevron-left": [<path d="m15 18-6-6 6-6" />],
  "chevron-right": [<path d="m9 18 6-6-6-6" />],
  copy: [
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />,
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />,
  ],
  "undo-2": [<path d="M9 14 4 9l5-5" />, <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />],
  "settings-2": [<path d="M14 17H5" />, <path d="M19 7h-9" />, <circle cx="17" cy="17" r="3" />, <circle cx="7" cy="7" r="3" />],
  "circle-x": [<circle cx="12" cy="12" r="10" />, <path d="m15 9-6 6" />, <path d="m9 9 6 6" />],
  key: [
    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />,
    <path d="m21 2-9.6 9.6" />,
    <circle cx="7.5" cy="15.5" r="5.5" />,
  ],
  "shield-check": [
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
    <path d="m9 12 2 2 4-4" />,
  ],
  user: [<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />, <circle cx="12" cy="7" r="4" />],
} satisfies Record<string, JSX.Element[]>;

type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }): JSX.Element {
  return (
    <svg
      class="icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}
