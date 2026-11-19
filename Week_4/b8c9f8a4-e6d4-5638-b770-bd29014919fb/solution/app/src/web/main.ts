// The client's routes: the owner's screens, and a named link's buyer or inspector screen.

import { api, NoReply, Refused } from './api.js';
import { keepView, lastView } from './held-view.js';
import { el } from './dom.js';
import { MESSAGE } from '../shared/copy.js';
import { buyerPage } from './pages/buyer.js';
import { inspectorPage } from './pages/inspector.js';
import { endedPage } from './pages/ended.js';
import { signInPage } from './pages/signin.js';
import { garagePage } from './pages/garage.js';
import { carFilePage } from './pages/car-file.js';
import type { BuyerView, CarView, LinkView } from './types.js';

function root(): HTMLElement {
  const found = document.getElementById('app');
  if (found) return found;
  const made = el('div', { id: 'app' });
  document.body.append(made);
  return made;
}

/** A return value is honoured only when it is a path under /owner/. */
function safeReturn(value: string | null): string {
  if (!value) return '/owner/cars';
  if (!value.startsWith('/owner/') || value.startsWith('//')) return '/owner/cars';
  if (value.includes('://') || value.includes('\\')) return '/owner/cars';
  return value;
}

async function start(): Promise<void> {
  const holder = root();
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/owner') {
    const wanted = new URLSearchParams(window.location.search).get('return');
    signInPage(holder, safeReturn(wanted));
    return;
  }

  if (path.startsWith('/owner/')) {
    try {
      const cars = await api.get<{ cars: CarView[] }>('/api/owner/cars');
      if (path === '/owner/cars') {
        garagePage(holder, cars.cars);
        return;
      }
      const id = path.slice('/owner/cars/'.length);
      const car = await api.get<CarView>(`/api/owner/cars/${id}`);
      carFilePage(holder, car);
      return;
    } catch (error) {
      if (error instanceof Refused && error.status === 401) {
        window.location.replace(`/owner?return=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (error instanceof Refused && error.status === 404) {
        endedPage(holder, MESSAGE.carUnknown);
        return;
      }
      endedPage(holder, MESSAGE.carUnknown);
      return;
    }
  }

  if (path.startsWith('/l/')) {
    // A link page always starts at the top, whatever the browser remembers or the address says.
    window.history.scrollRestoration = 'manual';
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
    const token = path.slice('/l/'.length);
    try {
      const view = await api.get<LinkView>(`/api/link/${token}`);
      if (view.role === 'inspector') {
        keepView(token, view);
        inspectorPage(holder, token, view);
      } else {
        buyerPage(holder, token, view as BuyerView); // a buyer link's reply carries every buyer field
      }
    } catch (error) {
      if (error instanceof Refused && error.status === 410) {
        endedPage(holder, MESSAGE.linkEndedHeading, MESSAGE.linkEndedBody);
        return;
      }
      // With no signal the inspector reads the last panels and the queue from the device.
      const held = error instanceof NoReply ? lastView(token) : null;
      if (held) {
        inspectorPage(holder, token, held);
        return;
      }
      endedPage(holder, MESSAGE.linkUnknown);
    }
    return;
  }

  window.location.replace('/owner');
}

void start();
