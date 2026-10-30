import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../ui/dialog.js';
import { ChevronDown, ChevronRight, MenuIcon } from '../ui/icons.js';
import { EASE_IN_OUT, enter } from '../ui/motion.js';

type Link = [label: string, href: string];

const MENUS: { name: string; links: Link[] }[] = [
  {
    name: 'Creative',
    links: [
      ['Overview', '/product'],
      ['Use Cases', '/use-cases'],
      ['Examples', '/examples'],
      ['Pricing', '/pricing'],
      ['Team Plan', '/team-plan'],
      ['Login', '/login'],
    ],
  },
  { name: 'Research', links: [['Research Hub', '/research']] },
  {
    name: 'Resources',
    links: [
      ['Resource Hub', '/resources'],
      ['Workflows', '/workflows'],
    ],
  },
  {
    name: 'Enterprise',
    links: [
      ['Overview', '/enterprise'],
      ['Contact Sales', '/enterprise-contact'],
      ['Model Licensing', '/model-licensing'],
    ],
  },
];

const FOOTER: { name: string; links: Link[] }[] = [
  MENUS[0],
  MENUS[1],
  MENUS[2],
  { name: 'Company', links: [...MENUS[3].links, ['Privacy Policy', '/privacy']] },
];

export function Wordmark({ suffix }: { suffix?: string }) {
  return (
    <a href={suffix ? '/studio' : '/'} class="wordmark" aria-label="Kinora">
      <span class="wordmark-mark" aria-hidden="true" />
      <span aria-hidden="true">kinora</span>
      {suffix && <span class="wordmark-suffix" aria-hidden="true">{suffix}</span>}
    </a>
  );
}

function HeaderActions() {
  return (
    <>
      <a class="button button-light" href="/enterprise-contact">Enterprise Sales</a>
      <a class="button button-light" href="/login">Login</a>
      <a class="button button-dark" href="/signup">Try Kinora</a>
    </>
  );
}

function Band() {
  return (
    <div class="band">
      <p>
        Enterprises get 2 months of usage free. Sign by 10/31. <a href="/team-plan" class="band-link">See terms</a>
      </p>
      <a href="/enterprise-contact" class="pill pill-outline">
        Contact sales <ChevronRight size={14} />
      </a>
    </div>
  );
}

function HeaderMenus() {
  const [open, setOpen] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(null);
      nav.current?.querySelector<HTMLButtonElement>(`[data-menu="${open}"]`)?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav ref={nav} class="header-nav" aria-label="Main">
      <ul class="header-menus">
        {MENUS.map((menu) => {
          const id = `menu-${menu.name.toLowerCase()}`;
          const expanded = open === menu.name;
          return (
            <li key={menu.name} class="header-menu">
              <button
                type="button"
                class="menu-button"
                data-menu={menu.name}
                aria-expanded={expanded ? 'true' : 'false'}
                aria-controls={id}
                onClick={() => setOpen(expanded ? null : menu.name)}
              >
                {menu.name} <ChevronDown size={14} class={expanded ? 'is-flipped' : undefined} />
              </button>
              {expanded && (
                <div class="menu-panel" id={id} ref={(el) => enter(el, 150, 4, EASE_IN_OUT)}>
                  <ul>
                    {menu.links.map(([label, href]) => (
                      <li key={href}>
                        <a href={href} onClick={() => setOpen(null)}>{label}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
        <li>
          <a class="menu-button" href="/pricing">Pricing</a>
        </li>
      </ul>
    </nav>
  );
}

function PhoneMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="button button-light menu-toggle" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <MenuIcon /> Menu
      </button>
      {open && (
        <Dialog title="Menu" variant="drawer" heading={<Wordmark />} onClose={() => setOpen(false)}>
          <nav class="drawer-nav" aria-label="Site">
            {MENUS.map((menu) => (
              <div key={menu.name} class="drawer-group">
                <h3>{menu.name}</h3>
                <ul>
                  {menu.links.map(([label, href]) => (
                    <li key={href}>
                      <a href={href} onClick={() => setOpen(false)}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <a class="drawer-link" href="/pricing" onClick={() => setOpen(false)}>Pricing</a>
          </nav>
          <div class="drawer-actions" onClick={() => setOpen(false)}>
            <HeaderActions />
          </div>
        </Dialog>
      )}
    </>
  );
}

function Header() {
  return (
    <header class="site-header">
      <div class="site-header-inner">
        <Wordmark />
        <HeaderMenus />
        <div class="header-actions">
          <HeaderActions />
        </div>
        <PhoneMenu />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer class="site-footer">
      <div class="footer-columns">
        {FOOTER.map((column) => (
          <div key={column.name} class="footer-column">
            <h2>{column.name}</h2>
            <ul>
              {column.links.map(([label, href]) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div class="footer-bottom">
        <Wordmark />
        <p>©2026 Kinora AI, Inc.</p>
      </div>
    </footer>
  );
}

export function PublicLayout({ children }: { children: ComponentChildren }) {
  return (
    <div class="public">
      <Band />
      <Header />
      <main id="main" class="public-main">
        {children}
      </main>
      <Footer />
    </div>
  );
}
