import { AppBar } from '../ui/AppBar.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Link } from '../ui/Link.tsx';
import { usePageHeading } from '../ui/usePageHeading.ts';

export function NotFound() {
  const heading = usePageHeading();
  return (
    <div class="auth-page">
      <AppBar />
      <main class="missing-main">
        <svg class="missing-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
          <path d="M30 76C70 76 90 40 140 40" fill="none" stroke="var(--c-azure)" stroke-width="30" stroke-linecap="round" />
          <path class="missing-gap" d="M168 40C196 40 214 54 232 72" fill="none" stroke="var(--c-orange)" stroke-width="30" stroke-linecap="round" stroke-dasharray="1 44" />
        </svg>
        <h1 ref={heading} tabIndex={-1}>
          We couldn't find that page.
        </h1>
        <p class="missing-lead">The link may be old, or the address may have a typo.</p>
        <Link href="/" class="btn btn-primary btn-lg">
          <Icon name="arrow-right" size={18} />
          <span>Back to Sprigmap</span>
        </Link>
      </main>
    </div>
  );
}
