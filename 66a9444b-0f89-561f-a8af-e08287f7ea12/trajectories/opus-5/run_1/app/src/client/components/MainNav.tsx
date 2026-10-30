import { useEffect, useState } from 'react';
import { useRoute, useUser } from '../lib/store.js';
import type { Role } from '../lib/types.js';
import type { JSX } from 'react';

const STAFF_LINKS: Partial<Record<Role, { href: string; label: string }>> = {
  artist: { href: '/studio', label: 'Studio' },
  curator: { href: '/curate', label: 'Curate' },
  box_office: { href: '/box-office', label: 'Box office' },
  finance: { href: '/finance', label: 'Finance' },
  admin: { href: '/admin', label: 'Admin' },
  group_booker: { href: '/group', label: 'Group' },
};

/** The sticky bar takes on the ground of whichever section fills most of the viewport. */
function useSectionGround(): string {
  const [ground, setGround] = useState('ink');

  useEffect(() => {
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const sections = Array.from(document.querySelectorAll<HTMLElement>('[class*="ground-"]'));
      let best = 'ink';
      let bestShare = 0;
      for (const section of sections) {
        const bounds = section.getBoundingClientRect();
        const visible =
          Math.min(bounds.bottom, window.innerHeight) - Math.max(bounds.top, 0);
        const share = Math.max(0, visible) / window.innerHeight;
        if (share > bestShare) {
          bestShare = share;
          best =
            Array.from(section.classList)
              .find((name) => name.startsWith('ground-'))
              ?.slice('ground-'.length) ?? 'ink';
        }
      }
      if (bestShare > 0.5) setGround(best);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  return ground;
}

export function MainNav(): JSX.Element {
  const route = useRoute();
  const { user, signOut } = useUser();
  const ground = useSectionGround();
  const staff = user === null ? undefined : STAFF_LINKS[user.role];

  const go = (event: React.MouseEvent<HTMLAnchorElement>, href: string): void => {
    event.preventDefault();
    if (href.startsWith('/#')) {
      route.navigate('/');
      window.setTimeout(() => {
        document.querySelector(href.slice(1))?.scrollIntoView({ behavior: 'auto' });
      }, 50);
      return;
    }
    route.navigate(href);
  };

  return (
    <nav className={`main-nav nav-${ground}`} aria-label="Main">
      <a className="wordmark" href="/" onClick={(event) => go(event, '/')}>
        Kerf
      </a>
      <a href="/" onClick={(event) => go(event, '/')}>
        Programme
      </a>
      <a href="/#gallery" onClick={(event) => go(event, '/#gallery')}>
        Gallery
      </a>
      <a href="/#tickets" onClick={(event) => go(event, '/#tickets')}>
        Tickets
      </a>
      <a href="/tickets" onClick={(event) => go(event, '/tickets')}>
        My tickets
      </a>
      {staff !== undefined ? (
        <a href={staff.href} onClick={(event) => go(event, staff.href)}>
          {staff.label}
        </a>
      ) : null}
      {user === null ? (
        <a href="/signin" onClick={(event) => go(event, '/signin')}>
          Sign in
        </a>
      ) : (
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      )}
    </nav>
  );
}
