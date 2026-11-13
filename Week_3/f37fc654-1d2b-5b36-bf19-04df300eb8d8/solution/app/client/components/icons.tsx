// Icons: path data from Lucide (ISC licence), inlined; always decorative next to a text label.
const PATHS = {
  x: ["M18 6 6 18", "m6 6 12 12"],
  arrowRight: ["M5 12h14", "m12 5 7 7-7 7"],
  menu: ["M4 12h16", "M4 6h16", "M4 18h16"],
  upload: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"],
  check: ["M20 6 9 17l-5-5"],
  chevronLeft: ["m15 18-6-6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  grip: ["M5 9h14", "M5 15h14"],
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
