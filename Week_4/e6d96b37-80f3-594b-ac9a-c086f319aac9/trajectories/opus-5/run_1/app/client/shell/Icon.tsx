import { ICONS } from '../icons.generated.ts';

/**
 * A bundled Lucide icon. The paths are inlined at build time from the
 * installed `lucide-static` package, so nothing is fetched from another
 * origin. Icons are decoration beside their own text, never the only label.
 */
export function Icon({ name }: { name: keyof typeof ICONS }): JSX.Element {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] ?? '' }}
    />
  );
}
