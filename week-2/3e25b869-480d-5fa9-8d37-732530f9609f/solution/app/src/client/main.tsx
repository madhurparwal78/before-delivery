// The client: one shell (skip link, header, navigation, language toggle, service status) around each page.
import type { ComponentChildren } from 'preact';
import { options, render } from 'preact';
import { useEffect } from 'preact/hooks';
import { api } from './api';
import { AccountPage, OrderPage, SubscriptionPage } from './pages/account';
import { CheckoutPage, PlacedPage } from './pages/checkout';
import { ContactPage } from './pages/contact';
import { DropPage } from './pages/drop';
import { NotFoundPage } from './pages/not-found';
import { StudioPage } from './pages/studio';
import { SubscribePage } from './pages/subscribe';
import { type ServiceStatus, serviceStatus, setLocale, useCopy, useStore } from './state';

type Banner = 'checkout' | 'subscriptions' | null;

function pollStatus(): void {
  const check = async () => {
    const r = await api<ServiceStatus>('GET', '/api/status');
    if (r.ok) serviceStatus.set(r.data);
  };
  void check();
  setInterval(() => void check(), 5000);
}

function focusHeading(): void {
  document.querySelector<HTMLElement>('main h1')?.focus();
}

function Shell({ banner, children }: { banner: Banner; children: ComponentChildren }) {
  const { m, l } = useCopy();
  const status = useStore(serviceStatus);
  const path = location.pathname;
  const links: [string, string][] = [
    ['/', m.navDrop],
    ['/subscribe', m.navSubscribe],
    ['/account', m.navAccount],
    ['/contact', m.navContact],
  ];
  const current = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const bannerText = status.billing === 'down' ? (banner === 'checkout' ? m.bannerCheckout : banner === 'subscriptions' ? m.bannerSubscriptions : '') : '';
  return (
    <>
      <a
        class="skip"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          focusHeading();
        }}
      >
        {m.skip}
      </a>
      <header class="site-header">
        <div class="header-inner">
          <a class="brand" href="/">
            {m.brand}
          </a>
          <nav aria-label={m.mainNav} class="main-nav">
            {links.map(([href, label]) => (
              <a key={href} href={href} aria-current={current(href) ? 'page' : undefined}>
                {label}
              </a>
            ))}
          </nav>
          <button type="button" class="lang-toggle" lang={l === 'en-CA' ? 'fr-CA' : 'en-CA'} onClick={() => setLocale(l === 'en-CA' ? 'fr-CA' : 'en-CA')}>
            {m.toggle}
          </button>
        </div>
      </header>
      <div role="status" aria-label={m.serviceStatus} class={`service-status${bannerText ? ' is-on' : ''}`}>
        {bannerText}
      </div>
      <main id="main">{children}</main>
      <footer class="site-footer">
        <p>{m.footer}</p>
      </footer>
    </>
  );
}

function route(): { banner: Banner; page: ComponentChildren } {
  if (document.body.dataset.pageStatus === '404') return { banner: null, page: <NotFoundPage /> };
  const path = location.pathname;
  const tail = (prefix: string) => decodeURIComponent(path.slice(prefix.length));
  if (path === '/') return { banner: 'checkout', page: <DropPage /> };
  if (path === '/checkout') return { banner: 'checkout', page: <CheckoutPage /> };
  if (path.startsWith('/checkout/placed/')) return { banner: 'checkout', page: <PlacedPage number={tail('/checkout/placed/')} /> };
  if (path === '/subscribe') return { banner: 'subscriptions', page: <SubscribePage /> };
  if (path === '/account') return { banner: 'subscriptions', page: <AccountPage /> };
  if (path.startsWith('/account/orders/')) return { banner: 'subscriptions', page: <OrderPage number={tail('/account/orders/')} /> };
  if (path.startsWith('/account/subscriptions/')) return { banner: 'subscriptions', page: <SubscriptionPage number={tail('/account/subscriptions/')} /> };
  if (path === '/contact') return { banner: null, page: <ContactPage /> };
  return { banner: null, page: <StudioPage section={path.split('/')[2] ?? ''} /> };
}

function App() {
  useEffect(pollStatus, []);
  const { banner, page } = route();
  return <Shell banner={banner}>{page}</Shell>;
}

/** Hook effects run in the task after rendering, never waiting on animation frames. */
const effects = new MessageChannel();
const pending: (() => void)[] = [];
effects.port1.onmessage = () => pending.splice(0).forEach((run) => run());
options.requestAnimationFrame = (run) => {
  pending.push(run);
  effects.port2.postMessage(null);
};

history.scrollRestoration = 'manual';
render(<App />, document.getElementById('app') as HTMLElement);
