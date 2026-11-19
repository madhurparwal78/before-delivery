/**
 * Lucide outline icons (ISC), inlined as paths. Every icon sits beside a text
 * label or carries an accessible name, so none of them stands alone.
 */
const PATHS = {
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  menu: ['M4 12h16', 'M4 6h16', 'M4 18h16'],
  diamond: ['M12 2 22 12 12 22 2 12z'],
  play: ['m6 3 14 9-14 9V3z'],
  pause: ['M14 4h4v16h-4z', 'M6 4h4v16H6z'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  label,
  className,
}: {
  name: IconName;
  /** Omit for a decorative icon that sits beside its own text label. */
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
