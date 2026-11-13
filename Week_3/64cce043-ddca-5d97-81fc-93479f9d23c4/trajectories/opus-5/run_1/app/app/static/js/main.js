// The app shell: chrome, routing, the live stream and the identity-outage banner.

import { ApiError, api } from './api.js';
import { announce, clear, h } from './dom.js';
import { loadVocabulary } from './vocab.js';
import * as drafts from './drafts.js';
import { ledgerScreen } from './screens/ledger.js';
import { holdingScreen } from './screens/holding.js';
import { breachesScreen } from './screens/breaches.js';
import { breachScreen } from './screens/breach.js';
import { rulesScreen } from './screens/rules.js';
import { contactScreen } from './screens/contact.js';
import { accountScreen } from './screens/account.js';
import { sharedScreen } from './screens/shared.js';

const OUTAGE_COPY =
    'Sign-in service unavailable. Your ledger still works; signing in, changing passwords and granting access are paused.';
const STATUS_INTERVAL = 30_000;
const PHONE = '(max-width: 599px)';

const NAV_LINKS = [
    ['/vault', 'Ledger'],
    ['/vault/breaches', 'Breaches'],
    ['/vault/rules', 'Rules'],
    ['/vault/contact', 'Trusted contact'],
    ['/vault/account', 'Account'],
];

const ROUTES = [
    [/^\/vault$/, ledgerScreen],
    [/^\/vault\/holdings\/([^/]+)$/, holdingScreen],
    [/^\/vault\/breaches$/, breachesScreen],
    [/^\/vault\/breaches\/([^/]+)$/, breachScreen],
    [/^\/vault\/rules$/, rulesScreen],
    [/^\/vault\/contact$/, contactScreen],
    [/^\/vault\/account$/, accountScreen],
    [/^\/shared$/, sharedScreen],
];

const draftStatus = h('p', {
    class: 'notice-line',
    role: 'status',
    'aria-label': 'Draft restored',
});

const app = {
    me: null,
    screen: null,
    stream: null,
    accessEnded: false,
    menuOpen: false,
    carried: null,
    navigate,
    signOut,
    draftRestored: () => announce(draftStatus, drafts.DRAFT_RESTORED),
    // An announcement that belongs on the screen the person lands on next.
    announceNext: (text) => {
        app.carried = text;
    },
    takeAnnouncement: () => {
        const text = app.carried;
        app.carried = null;
        return text;
    },
};

function outageSlot() {
    return document.getElementById('outage');
}

async function pollIdentityStatus() {
    try {
        const status = await api.get('/api/status');
        const slot = outageSlot();
        if (!slot) return;
        if (status.identity === 'down') {
            if (!slot.firstChild) {
                slot.append(h('p', { class: 'outage', role: 'alert', text: OUTAGE_COPY }));
            }
        } else {
            clear(slot);
        }
    } catch (error) {
        // The banner follows the status route alone, so a failed poll changes nothing.
    }
}

function topBar() {
    const phone = window.matchMedia(PHONE).matches;
    const owner = app.me.role === 'owner';
    const bar = h('header', { class: 'topbar' }, h('p', { class: 'wordmark', text: 'Hollowmere' }));

    if (owner && phone) {
        bar.append(
            h('button', {
                type: 'button',
                'aria-label': 'Menu',
                'aria-expanded': app.menuOpen ? 'true' : 'false',
                text: 'Menu',
                onclick: () => {
                    app.menuOpen = !app.menuOpen;
                    renderChrome();
                    const button = document.querySelector('[aria-label="Menu"]');
                    if (button) button.focus();
                },
                onkeydown: (event) => {
                    if (event.key === 'Escape' && app.menuOpen) {
                        app.menuOpen = false;
                        renderChrome();
                        document.querySelector('[aria-label="Menu"]').focus();
                    }
                },
            }),
        );
    }
    if (owner && (!phone || app.menuOpen)) {
        bar.append(
            h(
                'nav',
                { 'aria-label': 'Vault' },
                h(
                    'ul',
                    {},
                    NAV_LINKS.map(([href, label]) =>
                        h(
                            'li',
                            {},
                            h('a', {
                                href,
                                text: label,
                                'aria-current': location.pathname === href ? 'page' : null,
                            }),
                        ),
                    ),
                ),
            ),
        );
    }
    bar.append(h('span', { class: 'spacer' }));
    bar.append(h('button', { type: 'button', text: 'Sign out', onclick: signOut }));
    return bar;
}

function renderChrome() {
    const old = document.querySelector('.topbar');
    const bar = topBar();
    if (old) {
        old.replaceWith(bar);
    } else {
        document.getElementById('screen').before(bar);
        bar.after(draftStatus);
    }
    if (app.menuOpen) {
        const first = bar.querySelector('nav a');
        if (first) first.focus();
    }
}

async function signOut() {
    drafts.discard();
    try {
        await api.post('/auth/logout');
    } catch (error) {
        // Signing out locally is enough to leave the vault.
    }
    location.assign('/');
}

function mountPoint() {
    return document.getElementById('screen');
}

async function renderScreen() {
    const path = location.pathname;
    const found = ROUTES.map(([pattern, factory]) => [pattern.exec(path), factory]).find(
        ([match]) => match,
    );
    if (app.screen && app.screen.destroy) app.screen.destroy();
    app.screen = null;
    const mount = mountPoint();
    clear(mount);
    if (!found) {
        location.assign(location.pathname + location.search);
        return;
    }
    const [match, factory] = found;
    try {
        app.screen = await factory(mount, app, match.slice(1));
    } catch (error) {
        if (error instanceof ApiError && error.isSignedOut) {
            location.assign('/');
            return;
        }
        if (error instanceof ApiError && error.isAccessEnded) {
            app.accessEnded = true;
            app.screen = await sharedScreen(mount, app, []);
            return;
        }
        mount.append(h('p', { class: 'alert', role: 'alert', text: error.message }));
    }
}

function navigate(path, { replace = false } = {}) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    renderChrome();
    return renderScreen();
}

function interceptLinks() {
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
        const link = event.target.closest('a[href^="/"]');
        if (!link || link.target === '_blank') return;
        if (link.getAttribute('href').startsWith('/auth/')) return;
        event.preventDefault();
        if (app.menuOpen) app.menuOpen = false;
        navigate(link.getAttribute('href'));
    });
}

function openStream() {
    const stream = new EventSource('/api/events');
    app.stream = stream;
    stream.addEventListener('change', (event) => {
        const change = JSON.parse(event.data);
        if (app.screen && app.screen.onChange) app.screen.onChange(change);
    });
    stream.addEventListener('access-ended', () => {
        app.accessEnded = true;
        if (app.screen && app.screen.onAccessEnded) app.screen.onAccessEnded();
        stream.close();
    });
    stream.addEventListener('error', async () => {
        try {
            await api.get('/api/me');
        } catch (error) {
            if (error instanceof ApiError && error.isSignedOut) {
                stream.close();
                if (app.me.role === 'contact' && !app.accessEnded) location.assign('/');
            }
        }
    });
}

async function boot() {
    const screen = document.body.dataset.screen;
    await pollIdentityStatus();
    window.setInterval(pollIdentityStatus, STATUS_INTERVAL);
    if (screen === 'static') return;

    try {
        app.me = await api.get('/api/me');
        await loadVocabulary();
    } catch (error) {
        location.assign('/');
        return;
    }
    const draft = drafts.peek();
    if (draft && draft.email !== app.me.email) drafts.discard();

    renderChrome();
    interceptLinks();
    window.addEventListener('popstate', () => {
        const sameScreen = app.screen && app.screen.onQuery && app.screen.path === location.pathname;
        renderChrome();
        if (sameScreen) app.screen.onQuery(new URLSearchParams(location.search));
        else renderScreen();
    });
    window.matchMedia(PHONE).addEventListener('change', () => {
        app.menuOpen = false;
        renderChrome();
    });
    await renderScreen();
    openStream();
}


boot();
