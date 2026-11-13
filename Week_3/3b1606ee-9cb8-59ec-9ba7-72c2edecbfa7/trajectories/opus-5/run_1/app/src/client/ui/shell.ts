import { copy } from '../copy.js';
import { on, state, unreadTotal } from '../data/store.js';
import { markOpenConversationRead } from '../data/sync.js';
import { chatsView, requestsView, type ListView } from './chats.js';
import { contactCardColumn } from './contactcard.js';
import { contactsScreen } from './contacts.js';
import { conversationScreen } from './conversation.js';
import { el } from './dom.js';
import { landingScreen } from './landing.js';
import { registerRegions, setStorageOutage } from './live.js';
import { currentRoute, navigate, startRouter, type Route } from './router.js';
import { settingsScreen } from './settings.js';
import { signInScreen } from './signin.js';
import { signUpScreen } from './signup.js';
import { startToasts } from './toasts.js';

interface Shell {
  element: HTMLElement;
  listPane: HTMLElement;
  conversationPane: HTMLElement;
  cardPane: HTMLElement;
  chatsLink: HTMLAnchorElement;
}

let shell: Shell | null = null;
let listView: ListView | null = null;
let listViewRoute: Route['name'] | null = null;
let onSignedIn: (() => Promise<void>) | null = null;

function buildShell(): Shell {
  const outage = el('div', { class: 'alert-region', attrs: { role: 'alert' } });
  const updates = el('div', {
    class: 'live',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Letter updates' },
  });
  const notifications = el('div', {
    class: 'toasts',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Notifications' },
  });
  const connection = el('div', {
    class: 'connection',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Connection' },
  });

  const listPane = el('section', { class: 'pane pane-list' });
  const conversationPane = el('section', { class: 'pane pane-conversation' });
  const cardPane = el('aside', { class: 'pane pane-card' });

  const chatsLink = el('a', { class: 'tab', attrs: { href: '/letters' } }, [
    el('span', { text: 'Chats' }),
  ]);
  const nav = el('nav', { class: 'tabbar', attrs: { 'aria-label': 'Main' } }, [
    chatsLink,
    el('a', { class: 'tab', text: 'Contacts', attrs: { href: '/contacts' } }),
    el('a', { class: 'tab', text: 'Settings', attrs: { href: '/settings' } }),
  ]);

  const element = el('div', { class: 'app' }, [
    outage,
    el('div', { class: 'regions' }, [updates, notifications, connection]),
    listPane,
    conversationPane,
    cardPane,
    nav,
  ]);

  registerRegions({ updates, notifications, connection, outage });
  setStorageOutage(state.storageOut);
  startToasts(notifications);
  return { element, listPane, conversationPane, cardPane, chatsLink };
}

function paintBadge(): void {
  if (shell === null) return;
  const count = unreadTotal();
  const link = shell.chatsLink;
  link.replaceChildren(el('span', { text: 'Chats' }));
  if (count > 0) {
    link.dataset['testid'] = 'tab-unread-badge';
    link.append(
      el('span', {
        class: 'unread',
        text: count > 99 ? '99+' : String(count),
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  } else {
    delete link.dataset['testid'];
  }
  document.title = count > 0 ? `(${count}) Airfold` : 'Airfold';
}

function signedOutScreen(): HTMLElement {
  const screen = el('div', { class: 'form-screen signed-out' }, [
    el('h1', { text: 'Signed out' }),
    el('p', { text: copy.signedOut }),
    el('a', { class: 'ink-button', text: 'Restore account', attrs: { href: '/signin' } }),
  ]);
  return screen;
}

function publicScreen(route: Route, root: HTMLElement): void {
  const signedIn = onSignedIn ?? (async () => undefined);
  if (route.name === 'signup') {
    root.replaceChildren(signUpScreen(signedIn));
    return;
  }
  if (route.name === 'signin') {
    root.replaceChildren(signInScreen(signedIn));
    return;
  }
  root.replaceChildren(landingScreen());
}

function listFor(name: Route['name']): ListView | HTMLElement {
  switch (name) {
    case 'requests':
      return requestsView();
    case 'contacts':
      return contactsScreen();
    case 'settings':
      return settingsScreen();
    default:
      return chatsView();
  }
}

export function renderRoute(route: Route): void {
  const root = document.getElementById('app');
  if (root === null) return;

  if (state.signedOut) {
    root.replaceChildren(signedOutScreen());
    return;
  }
  if (state.me === null) {
    if (route.name === 'letters' || route.name === 'conversation' || route.name === 'requests' ||
        route.name === 'contacts' || route.name === 'settings') {
      navigate('/', { replace: true });
      return;
    }
    publicScreen(route, root);
    return;
  }
  if (route.name === 'landing' || route.name === 'signup' || route.name === 'signin' ||
      route.name === 'unknown') {
    navigate('/letters', { replace: true });
    return;
  }

  shell ??= buildShell();
  if (root.firstChild !== shell.element) root.replaceChildren(shell.element);

  const listRoute = route.name === 'conversation' ? 'letters' : route.name;
  if (listViewRoute !== listRoute) {
    listViewRoute = listRoute;
    const built = listFor(listRoute);
    if (built instanceof HTMLElement) {
      listView = null;
      shell.listPane.replaceChildren(built);
    } else {
      listView = built;
      shell.listPane.replaceChildren(built.element);
    }
  } else {
    listView?.update();
  }

  shell.element.dataset['view'] = route.name;
  state.openConversationId = route.conversationId;
  if (route.conversationId === null) {
    shell.conversationPane.replaceChildren(
      el('div', { class: 'conversation-placeholder' }),
    );
    shell.cardPane.replaceChildren();
  } else {
    shell.conversationPane.replaceChildren(conversationScreen(route.conversationId));
    shell.cardPane.replaceChildren(contactCardColumn(route.conversationId));
    void markOpenConversationRead();
  }
  paintBadge();
}

export function startShell(signedIn: () => Promise<void>): void {
  onSignedIn = signedIn;
  on('conversations', () => {
    listView?.update();
    paintBadge();
    const open = currentRoute().conversationId;
    if (open !== null && shell !== null) {
      shell.cardPane.replaceChildren(contactCardColumn(open));
    }
  });
  on('letter', () => {
    listView?.update();
    paintBadge();
  });
  on('me', () => paintBadge());
  on('signed-out', () => renderRoute(currentRoute()));
  startRouter(renderRoute);
}
