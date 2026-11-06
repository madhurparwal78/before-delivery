/**
 * The public frame: a fixed header that flips over dark sections, the wipe
 * panel, and focus moved to each new page's level-one heading.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LiveRegions } from '../lib/announce.jsx';
import { PrimaryLink } from './Buttons.jsx';
import { Link, setPageTitle, useRouter } from '../lib/router.jsx';

function toneUnderHeader(headerHeight: number): 'light' | 'dark' {
  const midpoint = headerHeight / 2;
  const sections = document.querySelectorAll<HTMLElement>('[data-tone]');
  for (const section of sections) {
    if (section.classList.contains('public-header')) continue;
    const box = section.getBoundingClientRect();
    if (box.top <= midpoint && box.bottom > midpoint) {
      return section.dataset.tone === 'dark' ? 'dark' : 'light';
    }
  }
  return 'light';
}

export function PublicShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  const { pathname, search } = useRouter();
  const [tone, setTone] = useState<'light' | 'dark'>('light');
  const header = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setPageTitle(title);
  }, [title]);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const height = header.current?.offsetHeight ?? 0;
      setTone(toneUnderHeader(height));
    };
    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [pathname, search]);

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
    window.scrollTo(0, 0);
  }, [pathname, search]);

  return (
    <div className="public">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="public-header" data-tone={tone} ref={header}>
        <Link to="/" className="public-mark">
          Marrow Hall
        </Link>
        <nav className="public-nav" aria-label="Main">
          <ul>
            <li>
              <Link to="/work">Work</Link>
            </li>
            <li>
              <PrimaryLink to="/start" label="Start a project" />
            </li>
          </ul>
        </nav>
      </header>
      <LiveRegions scope="public" />
      <main className="public-main" id="content" tabIndex={-1}>
        {children}
      </main>
      <div className="panel-wipe" aria-hidden="true" />
    </div>
  );
}
