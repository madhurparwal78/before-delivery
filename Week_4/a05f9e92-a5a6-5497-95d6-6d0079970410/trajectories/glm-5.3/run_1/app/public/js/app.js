// Screen routing and the landing poster.
import { api, announce } from './core.js';
import { renderShell, refreshSession, homeScreen, isSignedIn, notFoundState, mayOpen } from './shell.js';
import { renderPortrait } from './portrait.js';
const routes = [
    { pattern: /^\/$/, render: () => landing() },
    { pattern: /^\/login$/, render: () => signIn(), subject: () => 'Sign in' },
    { pattern: /^\/desk$/, render: () => import('./desk.js').then(m => m.desk()) },
    { pattern: /^\/desk\/lists\/([a-z_]+)$/, render: m => import('./desk.js').then(mod => mod.desk(m[1])) },
    { pattern: /^\/desk\/records\/new\/([a-z_]+)$/, render: m => import('./desk.js').then(mod => mod.desk(undefined, m[1])) },
    { pattern: /^\/desk\/records\/([A-Za-z]+-\d+)$/, render: m => import('./desk.js').then(mod => mod.desk(undefined, undefined, m[1])) },
    { pattern: /^\/desk\/map$/, render: () => import('./screens.js').then(m => m.serviceMap()), subject: () => 'Service map' },
    { pattern: /^\/desk\/major\/([A-Za-z]+-\d+)$/, render: m => import('./screens.js').then(mod => mod.major(m[1])) },
    { pattern: /^\/portal$/, render: () => import('./portal.js').then(m => m.portal()), subject: () => 'Ask the desk' },
    { pattern: /^\/portal\/items\/([^/]+)$/, render: m => import('./portal.js').then(mod => mod.catalogItem(decodeURIComponent(m[1]))) },
    { pattern: /^\/portal\/guides\/([^/]+)$/, render: m => import('./portal.js').then(mod => mod.orderGuide(decodeURIComponent(m[1]))) },
    { pattern: /^\/portal\/cart$/, render: () => import('./portal.js').then(m => m.cart()), subject: () => 'Cart' },
    { pattern: /^\/portal\/requests\/(ASK-\d+)$/, render: m => import('./portal.js').then(mod => mod.requestPage(m[1])) },
    { pattern: /^\/portal\/fault$/, render: () => import('./portal.js').then(m => m.reportFault()), subject: () => 'Report a fault' },
    { pattern: /^\/portal\/incidents\/(BRK-\d+)$/, render: m => import('./portal.js').then(mod => mod.portalIncident(m[1])) },
    { pattern: /^\/portal\/knowledge\/(ART-\d+)$/, render: m => import('./portal.js').then(mod => mod.article(m[1])) },
    { pattern: /^\/inbox$/, render: () => import('./screens.js').then(m => m.inboxScreen()), subject: () => 'Inbox' },
    { pattern: /^\/approve$/, render: () => import('./screens.js').then(m => m.approve()), subject: () => 'Your votes' },
    { pattern: /^\/desk\/oncall$/, render: () => import('./screens.js').then(m => m.oncall()), subject: () => 'On call' },
    { pattern: /^\/pages$/, render: () => import('./screens.js').then(m => m.pages()), subject: () => 'On call' },
    { pattern: /^\/desk\/changes\/calendar$/, render: () => import('./screens.js').then(m => m.calendar()), subject: () => 'Changes' },
    { pattern: /^\/desk\/boards\/(.+)$/, render: m => import('./screens.js').then(mod => mod.board(decodeURIComponent(m[1]))) },
    { pattern: /^\/desk\/workflows\/(\d+)$/, render: m => import('./screens.js').then(mod => mod.designer(Number(m[1]))) },
    { pattern: /^\/desk\/runs\/(\d+)$/, render: m => import('./screens.js').then(mod => mod.runView(Number(m[1]))) },
    { pattern: /^\/desk\/admin\/([a-z-]+)$/, render: m => import('./screens.js').then(mod => mod.admin(decodeURIComponent(m[1]))) },
    { pattern: /^\/desk\/dashboards\/(.+)$/, render: m => import('./screens.js').then(mod => mod.dashboard(m[1])) },
    { pattern: /^\/dashboards\/(.+)$/, render: m => import('./screens.js').then(mod => mod.dashboard(m[1])) },
    { pattern: /^\/desk\/config-sets$/, render: () => import('./screens.js').then(m => m.configSets()), subject: () => 'Configuration sets' },
    { pattern: /^\/desk\/imports$/, render: () => import('./screens.js').then(m => m.imports()), subject: () => 'Imports' },
    { pattern: /^\/desk\/exports$/, render: () => import('./screens.js').then(m => m.exports()), subject: () => 'Exports' },
];
async function route() {
    const path = location.pathname;
    await refreshSession();
    // A signed-in person opening /login goes to their home screen.
    if (path === '/login' && isSignedIn()) {
        location.href = homeScreen();
        return;
    }
    const entry = routes.find(r => r.pattern.test(path));
    if (entry && path !== '/' && path !== '/login' && !isSignedIn()) {
        location.replace('/login');
        return;
    }
    if (!entry || (path !== '/' && path !== '/login' && !mayOpen(path))) {
        renderShell('Not found', notFoundState());
        return;
    }
    const match = path.match(entry.pattern);
    const content = await entry.render(match);
    const subject = entry.subject ? entry.subject(match) : (content.getAttribute('data-subject') ?? 'Switchyard');
    renderShell(subject, content);
}
/** The hero poster: SWITCHYARD on the orange field over six portraits. */
async function landing() {
    const section = document.createElement('section');
    section.className = 'hero';
    section.setAttribute('data-subject', 'Switchyard');
    const title = document.createElement('h1');
    title.textContent = 'SWITCHYARD';
    section.appendChild(title);
    const portraits = document.createElement('div');
    portraits.className = 'portraits';
    const names = ['Mail', 'Project files', 'Payroll', 'Remote access', 'Printing', 'Sign-in'];
    for (const name of names) {
        const tile = document.createElement('div');
        renderPortrait(tile, { name }, `${name} portrait`);
        portraits.appendChild(tile);
    }
    section.appendChild(portraits);
    const sentence = document.createElement('p');
    sentence.className = 'hero-sentence';
    sentence.textContent = 'One person, one organisation, every promise kept on its own clock.';
    section.appendChild(sentence);
    const footer = document.createElement('div');
    footer.className = 'hero-footer';
    const open = document.createElement('a');
    open.className = 'solid';
    open.setAttribute('role', 'link');
    open.textContent = 'Open your desk';
    open.href = isSignedIn() ? homeScreen() : '/login';
    footer.appendChild(open);
    section.appendChild(footer);
    return section;
}
/** Sign in with a seeded username and password. */
async function signIn() {
    const section = document.createElement('section');
    section.className = 'white';
    const wrapper = document.createElement('div');
    wrapper.style.maxWidth = '64ch';
    wrapper.style.margin = '0 auto';
    const form = document.createElement('form');
    const userLabel = document.createElement('label');
    userLabel.textContent = 'Username';
    const username = document.createElement('input');
    username.setAttribute('aria-label', 'Username');
    userLabel.appendChild(username);
    form.appendChild(userLabel);
    const passLabel = document.createElement('label');
    passLabel.textContent = 'Password';
    const password = document.createElement('input');
    password.type = 'password';
    passLabel.appendChild(password);
    form.appendChild(passLabel);
    const submit = document.createElement('button');
    submit.className = 'solid';
    submit.type = 'submit';
    submit.textContent = 'Sign in';
    form.appendChild(submit);
    const error = document.createElement('p');
    form.appendChild(error);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submit.textContent = 'Signing in...';
        error.textContent = '';
        try {
            await api('/api/session', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value }) });
            announce('Signed in.');
            await refreshSession();
            location.href = homeScreen();
        }
        catch {
            submit.textContent = 'Sign in';
            error.textContent = 'That username and password do not match.';
            announce('That username and password do not match.');
        }
    });
    wrapper.appendChild(form);
    section.appendChild(wrapper);
    return section;
}
window.addEventListener('popstate', () => void route());
void route();
