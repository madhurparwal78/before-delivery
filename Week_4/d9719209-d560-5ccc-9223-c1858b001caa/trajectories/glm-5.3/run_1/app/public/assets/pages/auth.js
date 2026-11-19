/* Account screens: sign-up, sign-in with the TOTP step, verify, forgot and
   reset. Each refuses invalid submits with field errors and focus moves. */
import { api, announce, el, navigate, ApiFailure } from '../lib.js';
export function renderAuthPages(frame, path, search) {
    const feedCol = el('main', { class: 'feed' });
    frame.append(feedCol);
    const params = new URLSearchParams(search);
    const next = params.get('next') ?? '/';
    if (path === '/signup')
        signup(feedCol, next);
    else if (path === '/login')
        login(feedCol, next);
    else if (path === '/verify')
        verify(feedCol, params);
    else if (path === '/forgot')
        forgot(feedCol);
    else if (path === '/reset')
        reset(feedCol, params);
}
function field(label, input, errEl) {
    return el('label', { class: 'field' }, el('span', { class: 'label' }, label), input, errEl);
}
function failField(err, fieldMap) {
    let first = null;
    for (const [name, message] of Object.entries(err.fields)) {
        const target = fieldMap[name];
        if (target === undefined)
            continue;
        target.input.setAttribute('aria-invalid', 'true');
        target.input.setAttribute('aria-describedby', `${name}-error`);
        target.err.id = `${name}-error`;
        target.err.replaceChildren(el('span', { class: 'field-error' }, message));
        if (first === null)
            first = target.input;
    }
    first?.focus();
}
function signup(host, next) {
    const email = el('input', { class: 'input', type: 'email', 'aria-label': 'Email' });
    const username = el('input', { class: 'input', type: 'text', 'aria-label': 'Username' });
    const password = el('input', { class: 'input', type: 'password', 'aria-label': 'Password' });
    const emailErr = el('span', {});
    const usernameErr = el('span', {});
    const passwordErr = el('span', {});
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Create account');
    const form = el('form', { class: 'panel', novalidate: true }, el('h1', {}, 'Create account'), field('Email', email, emailErr), field('Username', username, usernameErr), field('Password', password, passwordErr), el('div', { class: 'dialog-actions' }, btn));
    host.append(form);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void (async () => {
            btn.textContent = 'Creating account...';
            try {
                const res = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({ email: email.value, username: username.value, password: password.value }) });
                const message = res.email ?? email.value;
                host.replaceChildren(el('div', { class: 'panel' }, el('h1', {}, 'Check your inbox'), el('p', {}, `We sent a confirmation link to ${message}.`)));
            }
            catch (err) {
                btn.textContent = 'Create account';
                if (err instanceof ApiFailure) {
                    failField(err, { email: { err: emailErr, input: email }, username: { err: usernameErr, input: username }, password: { err: passwordErr, input: password } });
                }
            }
        })();
    });
    void next;
}
function login(host, next) {
    const login = el('input', { class: 'input', type: 'text', 'aria-label': 'Email or username' });
    const password = el('input', { class: 'input', type: 'password', 'aria-label': 'Password' });
    const err = el('span', {});
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const form = el('form', { class: 'panel', novalidate: true }, el('h1', {}, 'Sign in'), field('Email or username', login, el('span', {})), field('Password', password, err), el('div', { class: 'dialog-actions' }, btn), el('p', {}, el('a', { href: '/forgot' }, 'Forgot your password?'), el('span', { class: 'sep' }, '·'), el('a', { href: '/signup' }, 'Create an account')));
    host.append(form);
    const submit = () => {
        void (async () => {
            btn.textContent = 'Signing in...';
            try {
                await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: login.value, password: password.value }) });
                navigate(next === '' ? '/' : next);
            }
            catch (e) {
                if (e instanceof ApiFailure && e.code === 'TOTP_REQUIRED') {
                    // Show the code step.
                    showCodeStep(host, next, login.value, password.value);
                    return;
                }
                btn.textContent = 'Sign in';
                if (e instanceof ApiFailure) {
                    if (e.fields.totp !== undefined)
                        announce(e.fields.totp, true);
                    else
                        announce(e.message, true);
                }
            }
        })();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
}
function showCodeStep(host, next, loginValue, passwordValue) {
    const code = el('input', { class: 'input', type: 'text', inputmode: 'numeric', 'aria-label': 'Authentication code', maxlength: '6' });
    const err = el('span', {});
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Verify');
    const form = el('form', { class: 'panel', novalidate: true }, el('h1', {}, 'Two-factor authentication'), el('p', {}, 'Enter the 6-digit code from your authenticator app'), field('Authentication code', code, err), el('div', { class: 'dialog-actions' }, btn));
    host.replaceChildren(form);
    code.focus();
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void (async () => {
            try {
                await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: loginValue, password: passwordValue, totp: code.value }) });
                navigate(next === '' ? '/' : next);
            }
            catch (e2) {
                if (e2 instanceof ApiFailure) {
                    announce(e2.fields.totp ?? 'That code didn\'t match', true);
                    code.setAttribute('aria-invalid', 'true');
                    err.replaceChildren(el('span', { class: 'field-error' }, e2.fields.totp ?? "That code didn't match"));
                }
            }
        })();
    });
}
function verify(host, params) {
    const token = params.get('token') ?? '';
    host.append(el('div', { class: 'panel' }, el('p', {}, 'Checking your link...')));
    void (async () => {
        try {
            await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ token }) });
            host.replaceChildren(el('div', { class: 'panel' }, el('h1', {}, 'Email confirmed'), el('p', {}, 'Your email is confirmed. You can vote, post and reply now.'), el('a', { class: 'btn primary', href: '/' }, 'Go to the home feed')));
        }
        catch {
            host.replaceChildren(el('div', { class: 'panel' }, el('h1', {}, 'This link has expired or was already used'), el('p', {}, 'You can ask for a new link from the banner on any page.')));
        }
    })();
}
function forgot(host) {
    const email = el('input', { class: 'input', type: 'email', 'aria-label': 'Email' });
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Send reset link');
    const form = el('form', { class: 'panel', novalidate: true }, el('h1', {}, 'Reset your password'), field('Email', email, el('span', {})), el('div', { class: 'dialog-actions' }, btn));
    host.append(form);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void (async () => {
            btn.textContent = 'Sending...';
            await api('/api/auth/password-reset', { method: 'POST', body: JSON.stringify({ email: email.value }) });
            host.replaceChildren(el('div', { class: 'panel' }, el('h1', {}, 'Check your inbox'), el('p', {}, 'If the address is registered, a reset link is on its way.')));
        })();
    });
}
function reset(host, params) {
    const token = params.get('token') ?? '';
    const password = el('input', { class: 'input', type: 'password', 'aria-label': 'New password' });
    const err = el('span', {});
    const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Set new password');
    const form = el('form', { class: 'panel', novalidate: true }, el('h1', {}, 'Set a new password'), field('New password', password, err), el('div', { class: 'dialog-actions' }, btn));
    host.append(form);
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        void (async () => {
            try {
                await api('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, newPassword: password.value }) });
                host.replaceChildren(el('div', { class: 'panel' }, el('h1', {}, 'Password updated'), el('p', {}, 'Sign in with your new password.'), el('a', { class: 'btn primary', href: '/login' }, 'Sign in')));
            }
            catch (e2) {
                if (e2 instanceof ApiFailure) {
                    err.replaceChildren(el('span', { class: 'field-error' }, Object.values(e2.fields)[0] ?? 'This link has expired or was already used'));
                    password.setAttribute('aria-invalid', 'true');
                    password.focus();
                }
            }
        })();
    });
}
