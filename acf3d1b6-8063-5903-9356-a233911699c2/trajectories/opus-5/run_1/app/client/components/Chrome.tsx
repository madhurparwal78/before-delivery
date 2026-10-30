import { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, MenuLines } from './Icons';
import { Drawer } from './ui';

interface MenuLink {
  label: string;
  href: string;
}

export const HEADER_MENUS: { label: string; links: MenuLink[] }[] = [
  {
    label: 'Creative',
    links: [
      { label: 'Overview', href: '/product' },
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Examples', href: '/examples' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Team Plan', href: '/team-plan' },
      { label: 'Login', href: '/login' }
    ]
  },
  { label: 'Research', links: [{ label: 'Research Hub', href: '/research' }] },
  {
    label: 'Resources',
    links: [
      { label: 'Resource Hub', href: '/resources' },
      { label: 'Workflows', href: '/workflows' }
    ]
  },
  {
    label: 'Enterprise',
    links: [
      { label: 'Overview', href: '/enterprise' },
      { label: 'Contact Sales', href: '/enterprise-contact' },
      { label: 'Model Licensing', href: '/model-licensing' }
    ]
  }
];

const HEADER_BUTTONS = [
  { label: 'Enterprise Sales', href: '/enterprise-contact', skin: 'btn-light' },
  { label: 'Login', href: '/login', skin: 'btn-light' },
  { label: 'Try Kinora', href: '/signup', skin: 'btn-dark' }
];

function AnnouncementBand() {
  return (
    <div class="band">
      <div class="shell band-inner">
        <span>Enterprises get 2 months of usage free. Sign by 10/31.</span>
        <a class="band-terms" href="/team-plan">
          See terms
        </a>
        <a class="btn btn-outline" href="/enterprise-contact">
          Contact sales
          <ChevronRight />
        </a>
      </div>
    </div>
  );
}

function SiteHeader() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [openMenu]);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !openMenu) return;
    document.getElementById(`menu-button-${openMenu}`)?.focus();
    setOpenMenu(null);
  };

  return (
    <header class="site-header">
      <div class="shell site-header-inner">
        <a class="wordmark" href="/" aria-label="Kinora">
          kinora
        </a>

        <div class="nav-centre" ref={holder} onKeyDown={closeOnEscape}>
          {HEADER_MENUS.map((menu) => (
            <div class="menu-holder" key={menu.label}>
              <button
                type="button"
                class="menu-button"
                id={`menu-button-${menu.label}`}
                aria-expanded={openMenu === menu.label ? 'true' : 'false'}
                onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              >
                {menu.label}
                <ChevronDown className="menu-chevron" />
              </button>
              {openMenu === menu.label ? (
                <div class="menu-panel">
                  {menu.links.map((link) => (
                    <a key={link.href} href={link.href} onClick={() => setOpenMenu(null)}>
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <a class="nav-link" href="/pricing">
            Pricing
          </a>
        </div>

        <div class="nav-right">
          {HEADER_BUTTONS.map((button) => (
            <a key={button.href + button.label} class={`btn ${button.skin}`} href={button.href}>
              {button.label}
            </a>
          ))}
        </div>

        <button type="button" class="btn btn-light header-mobile" onClick={() => setDrawerOpen(true)}>
          <MenuLines />
          Menu
        </button>
      </div>

      {drawerOpen ? (
        <Drawer title="kinora" onClose={() => setDrawerOpen(false)}>
          <nav class="sidebar-nav" aria-label="Site">
            {HEADER_MENUS.map((menu) => (
              <div key={menu.label}>
                <p class="eyebrow" style="margin:14px 0 4px">
                  {menu.label}
                </p>
                {menu.links.map((link) => (
                  <a
                    key={`${menu.label}-${link.href}`}
                    class="sidebar-link"
                    href={link.href}
                    onClick={() => setDrawerOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
            <a class="sidebar-link" href="/pricing" onClick={() => setDrawerOpen(false)}>
              Pricing
            </a>
          </nav>
          <div class="stack" style="margin-top:18px">
            {HEADER_BUTTONS.map((button) => (
              <a
                key={`drawer-${button.label}`}
                class={`btn ${button.skin}`}
                href={button.href}
                onClick={() => setDrawerOpen(false)}
              >
                {button.label}
              </a>
            ))}
          </div>
        </Drawer>
      ) : null}
    </header>
  );
}

function SiteFooter() {
  const columns = [
    { heading: 'Creative', links: HEADER_MENUS[0].links },
    { heading: 'Research', links: HEADER_MENUS[1].links },
    { heading: 'Resources', links: HEADER_MENUS[2].links },
    {
      heading: 'Company',
      links: [...HEADER_MENUS[3].links, { label: 'Privacy Policy', href: '/privacy' }]
    }
  ];

  return (
    <footer class="site-footer">
      <div class="shell">
        <div class="footer-columns">
          {columns.map((column) => (
            <nav key={column.heading} aria-labelledby={`footer-${column.heading}`}>
              <h2 id={`footer-${column.heading}`}>{column.heading}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.href}-${link.label}`}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div class="footer-bottom">
          <span class="wordmark">kinora</span>
          <span>©2026 Kinora AI, Inc.</span>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout({ children }: { children: ComponentChildren }) {
  return (
    <>
      <AnnouncementBand />
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
