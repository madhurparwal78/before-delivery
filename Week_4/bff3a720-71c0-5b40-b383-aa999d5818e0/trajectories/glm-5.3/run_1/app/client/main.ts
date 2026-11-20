import { h, clear } from './lib/els.js';
import { ApiFail } from './lib/api.js';
import { router } from './lib/router.js';
import { store } from './lib/store.js';
import { banner } from './shell.js';
import { homePage } from './pages/home.js';
import { searchPage } from './pages/search.js';
import { ridePage } from './pages/ride.js';
import { bookingPage } from './pages/booking.js';
import { offerPage } from './pages/offer.js';
import { myRidesPage } from './pages/myrides.js';
import { walletPage } from './pages/wallet.js';
import { earningsPage } from './pages/earnings.js';
import { profilePage } from './pages/profile.js';
import { signInPage } from './pages/signin.js';
import { founderIdReviewPage, founderNetworkPage } from './pages/founder.js';

document.documentElement.dataset.motionPref = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => {
  document.documentElement.dataset.motionPref = e.matches ? 'reduced' : 'full';
});

const app = document.getElementById('app')!;
app.append(banner());
const main = h('main', { class: 'page' });
app.append(main);

async function render(): Promise<void> {
  await store.ensureBootstrap();
  clear(main);
  const path = router.path;
  try {
    if (path === '/') main.append(homePage());
    else if (path === '/search') main.append(searchPage());
    else if (path.startsWith('/rides/')) main.append(await ridePage(path.slice('/rides/'.length)));
    else if (path.startsWith('/bookings/')) main.append(await bookingPage(path.slice('/bookings/'.length)));
    else if (path === '/offer') main.append(await offerPage());
    else if (path === '/my-rides') main.append(await myRidesPage());
    else if (path === '/wallet') main.append(await walletPage());
    else if (path === '/earnings') main.append(await earningsPage());
    else if (path === '/profile') main.append(await profilePage());
    else if (path === '/sign-in') main.append(await signInPage());
    else if (path === '/founder/id-review') main.append(await founderIdReviewPage());
    else if (path === '/founder/network') main.append(await founderNetworkPage());
    else main.append(notFoundPage());
  } catch (e) {
    if (e instanceof ApiFail && e.status === 401) {
      main.append(signInRequiredPage());
    } else {
      console.error(e);
      main.append(notFoundPage());
    }
  }
}

function signInRequiredPage(): HTMLElement {
  return h('div', null,
    h('h1', null, 'Sign in to continue.'),
    h('p', null, h('a', { href: '/sign-in' }, 'Go to the sign-in page.')),
  );
}

function notFoundPage(): HTMLElement {
  return h('div', null,
    h('h1', null, 'We could not find that page'),
    h('p', null, h('a', { href: '/search' }, 'Back to search')),
  );
}

router.subscribe(() => { void render(); });
window.addEventListener('click', (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.closest('a')) {
    const a = target.closest('a') as HTMLAnchorElement;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || a.hasAttribute('download')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.go(href);
  }
});

void render();
