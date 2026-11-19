import { Link } from './Link.tsx';

/** The Sprigmap mark: three flat ribbons that fork from one stem, in branch colours. Drawn for this product. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg class="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M3 26c6 0 8-5 12-10s8-8 14-9" fill="none" stroke="var(--c-indigo)" stroke-width="5" stroke-linecap="round" />
      <path d="M11 24c1-6 5-9 13-9" fill="none" stroke="var(--c-teal)" stroke-width="5" stroke-linecap="round" />
      <path d="M15 16c-1-4-4-7-10-8" fill="none" stroke="var(--c-orange)" stroke-width="5" stroke-linecap="round" />
    </svg>
  );
}

/** The logo link: mark and wordmark, to the home page. */
export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} class="logo" aria-label="Sprigmap">
      <LogoMark />
      <span class="logo-word">Sprigmap</span>
    </Link>
  );
}
