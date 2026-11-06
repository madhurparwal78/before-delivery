// Public site chrome: announcement band, sticky header with menus and the footer.
import { useState } from 'preact/hooks';
import { useRef } from 'preact/hooks';
import { useDismiss, useDialog, IconChevronDown, IconChevronRight, IconMenu } from './client.jsx';
import { ANNOUNCEMENT, FOOTER_NOTE } from '../content.mjs';

const MENUS = [
  { label: 'Creative', links: [
    { t: 'Overview', href: '/product' }, { t: 'Use Cases', href: '/use-cases' },
    { t: 'Examples', href: '/examples' }, { t: 'Pricing', href: '/pricing' },
    { t: 'Team Plan', href: '/team-plan' }, { t: 'Login', href: '/login' }] },
  { label: 'Research', links: [{ t: 'Research Hub', href: '/research' }] },
  { label: 'Resources', links: [
    { t: 'Resource Hub', href: '/resources' }, { t: 'Workflows', href: '/workflows' }] },
  { label: 'Enterprise', links: [
    { t: 'Overview', href: '/enterprise' }, { t: 'Contact Sales', href: '/enterprise-contact' },
    { t: 'Model Licensing', href: '/model-licensing' }] },
];

function HeaderMenu({ menu, open, onOpen, onClose }) {
  const btnRef = useRef(null);
  const wrapRef = useRef(null);
  useDismiss(open, () => { onClose(btnRef.current); }, wrapRef);
  return (
    <div class="menu-wrap" ref={wrapRef}>
      <button ref={btnRef} type="button" class="menu-btn" aria-haspopup="true"
        aria-expanded={open} aria-label={menu.label}
        onClick={() => (open ? onClose(btnRef.current) : onOpen(menu.label))}>
        {menu.label}
        <IconChevronDown />
      </button>
      {open && (
        <div class="menu-panel" role="group" aria-label={`${menu.label} menu`}>
          {menu.links.map(l => <a href={l.href}>{l.t}</a>)}
        </div>
      )}
    </div>
  );
}

function MobileDrawer({ onClose, onNavigate }) {
  const ref = useDialog(true, onClose);
  return (
    <div>
      <div class="drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-hidden="true" />
      <aside class="drawer" role="dialog" aria-modal="true" aria-label="Menu" ref={ref} tabIndex={-1}>
        <div class="spread" style="margin-bottom:10px">
          <a class="wordmark" href="/" aria-label="Kinora" onClick={onNavigate}><span class="dot" />kinora</a>
          <button type="button" class="dialog-close" aria-label="Close menu" onClick={onClose}>✕</button>
        </div>
        <nav class="row-links" aria-label="Site">
          {MENUS.flatMap(m => m.links).map(l => (
            <a href={l.href} onClick={onClose}>{l.t}</a>
          ))}
        </nav>
        <hr style="border:none;border-top:1px solid var(--hairline);margin:14px 0" />
        <div class="stack" style="gap:10px">
          <a class="btn btn-light" href="/enterprise-contact" onClick={onClose}>Enterprise Sales</a>
          <a class="btn btn-light" href="/login" onClick={onClose}>Login</a>
          <a class="btn btn-dark" href="/signup" onClick={onClose}>Try Kinora</a>
        </div>
      </aside>
    </div>
  );
}

export function PublicHeader() {
  const [openMenu, setOpenMenu] = useState(null);
  const [drawer, setDrawer] = useState(false);
  return (
    <header class="public-header">
      <div class="container public-header-inner">
        <a class="wordmark" href="/" aria-label="Kinora"><span class="dot" aria-hidden="true" />kinora</a>
        <nav class="header-nav" aria-label="Main">
          {MENUS.map(m => (
            <HeaderMenu key={m.label} menu={m} open={openMenu === m.label}
              onOpen={setOpenMenu} onClose={(btn) => { setOpenMenu(null); if (btn && btn.focus) btn.focus(); }} />
          ))}
          <a class="plain-link" href="/pricing">Pricing</a>
        </nav>
        <div class="header-actions">
          <a class="btn btn-light" href="/enterprise-contact">Enterprise Sales</a>
          <a class="btn btn-light" href="/login">Login</a>
          <a class="btn btn-dark" href="/signup">Try Kinora</a>
        </div>
        <button type="button" class="menu-open-btn" aria-label="Menu" aria-expanded={drawer}
          onClick={() => setDrawer(true)}>
          <IconMenu />
        </button>
      </div>
      {drawer && <MobileDrawer onClose={() => setDrawer(false)} />}
    </header>
  );
}

export function AnnouncementBand() {
  return (
    <div class="band">
      <div class="band-inner">
        <span>{ANNOUNCEMENT}</span>
        <a class="u-underline" href="/team-plan">See terms</a>
        <a class="btn btn-outline btn-pill" href="/enterprise-contact">Contact sales<IconChevronRight /></a>
      </div>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer class="public-footer">
      <div class="container">
        <div class="footer-cols">
          <div>
            <h4>Creative</h4>
            <a href="/product">Overview</a>
            <a href="/use-cases">Use Cases</a>
            <a href="/examples">Examples</a>
            <a href="/pricing">Pricing</a>
            <a href="/team-plan">Team Plan</a>
          </div>
          <div>
            <h4>Research</h4>
            <a href="/research">Research Hub</a>
          </div>
          <div>
            <h4>Resources</h4>
            <a href="/resources">Resource Hub</a>
            <a href="/workflows">Workflows</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="/enterprise">Enterprise</a>
            <a href="/enterprise-contact">Contact Sales</a>
            <a href="/model-licensing">Model Licensing</a>
            <a href="/privacy">Privacy Policy</a>
          </div>
        </div>
        <div class="footer-bottom">
          <a class="wordmark" href="/" aria-label="Kinora"><span class="dot" aria-hidden="true" />kinora</a>
          <span>{FOOTER_NOTE}</span>
        </div>
      </div>
    </footer>
  );
}

export function PublicLayout({ children }) {
  return (
    <div class="page">
      <AnnouncementBand />
      <a class="visually-hidden" href="#main">Skip to content</a>
      <PublicHeader />
      <main class="public-main" id="main">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
