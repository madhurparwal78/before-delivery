/** Lucide icon paths (ISC licence), drawn inline. */
const PATHS: Record<string, string[]> = {
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "chevron-right": ["m9 18 6-6-6-6"],
  "arrow-right": ["M5 12h14", "m12 5 7 7-7 7"],
  "arrow-up": ["m5 12 7-7 7 7", "M12 19V5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  plus: ["M5 12h14", "M12 5v14"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  check: ["M20 6 9 17l-5-5"],
  trash: ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"],
  paperclip: ["m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8"],
};

type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => <path d={d} key={d} />)}
    </svg>
  );
}

/** The logo mark: a coral and a black circle, linked. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.64} viewBox="0 0 44 28" aria-hidden="true" focusable="false" class="logo-mark">
      <path d="M14 14h16" stroke="#0D0D0D" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="14" cy="14" r="10" fill="#0D0D0D" />
      <circle cx="30" cy="14" r="10" fill="#F95A4E" />
    </svg>
  );
}
