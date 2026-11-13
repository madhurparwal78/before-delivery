/**
 * Icons from Lucide (ISC), drawn inline so the app ships no icon font and loads nothing
 * from another origin. Every icon sits beside its own text, so it is never the name of a
 * control.
 */

const PATHS = {
  search: ['m21 21-4.34-4.34', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'],
  filters: ['M10 5H3', 'M12 19H3', 'M14 3v4', 'M16 17v4', 'M21 12H3', 'M21 19h-5', 'M21 5h-7'],
  menu: ['M4 5h16', 'M4 12h16', 'M4 19h16'],
  previous: ['m15 18-6-6 6-6'],
  next: ['m9 18 6-6-6-6'],
  download: ['M12 15V3', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5'],
  tag: ['M7.5 7.5h.01', 'M3 3v8.4a2 2 0 0 0 .6 1.4l8 8a2 2 0 0 0 2.8 0l6.6-6.6a2 2 0 0 0 0-2.8l-8-8A2 2 0 0 0 11.4 3Z'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
