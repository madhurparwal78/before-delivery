import { api } from './api.js';
import { clear, h } from './dom.js';
import { copy } from './copy.js';
import { watchMotionPreference } from './motion.js';
import { addRoute, setNotFound, startRouter } from './router.js';
import { mainRegion, mountShell } from './shell.js';
import { loadMember, readPageConfig, setServerNow } from './state.js';
import { renderHome } from './pages/home.js';
import { renderSearch } from './pages/search.js';
import { renderRide } from './pages/ride.js';
import { renderBooking } from './pages/booking.js';
import { renderOffer } from './pages/offer.js';
import { renderMyRides } from './pages/myrides.js';
import { renderWallet } from './pages/wallet.js';
import { renderEarnings } from './pages/earnings.js';
import { renderProfile } from './pages/profile.js';
import { renderSignIn } from './pages/signin.js';
import { renderIdReview, renderNetwork } from './pages/founder.js';

function renderNotFound(): void {
  const main = mainRegion();
  clear(main);
  main.append(
    h('h1', { text: copy.notFoundHeading }),
    h('a', { href: '/search', text: 'Back to search' }),
  );
}

async function start(): Promise<void> {
  readPageConfig();
  watchMotionPreference();
  const root = document.getElementById('app');
  if (!root) return;

  const [, cities] = await Promise.all([
    loadMember(),
    api<{ server_now: string }>('GET', '/api/cities'),
  ]);
  if (cities.ok) setServerNow(cities.data.server_now);

  mountShell(root);

  addRoute('/', renderHome);
  addRoute('/search', renderSearch);
  addRoute('/rides/:id', renderRide);
  addRoute('/bookings/:id', renderBooking);
  addRoute('/offer', renderOffer);
  addRoute('/my-rides', renderMyRides);
  addRoute('/wallet', renderWallet);
  addRoute('/earnings', renderEarnings);
  addRoute('/profile', renderProfile);
  addRoute('/sign-in', renderSignIn);
  addRoute('/founder/id-review', renderIdReview);
  addRoute('/founder/network', renderNetwork);
  setNotFound(renderNotFound);

  startRouter();
}

void start();
