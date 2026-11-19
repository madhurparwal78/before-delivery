import { copy } from '../shared/copy.js';
import { request } from './api.js';
import { alertAnnounce, announce, applyFieldErrors, on, qs, setFieldError } from './dom.js';
import { page } from './state.js';

function submitButton(form: HTMLElement): HTMLButtonElement | null {
  return qs<HTMLButtonElement>('[data-submit]', form);
}

/** A brand-new account is unverified, so the banner belongs on the page at once. */
function showUnverifiedBanner(): void {
  if (qs('[data-unverified-banner]')) return;
  const banner = document.createElement('div');
  banner.className = 'unverified-banner';
  banner.setAttribute('data-unverified-banner', '');
  banner.innerHTML = `<p>${copy.verify.banner}</p><button type="button" data-resend-verification>Resend email</button>`;
  qs('.masthead')?.insertAdjacentElement('afterend', banner);
}

function initSignup(): void {
  const form = qs<HTMLFormElement>('[data-signup]');
  if (!form) return;
  const done = qs<HTMLElement>('[data-signup-done]');
  on(form, 'submit', (event) => {
    event.preventDefault();
    const email = qs<HTMLInputElement>('#email', form);
    const username = qs<HTMLInputElement>('#username', form);
    const password = qs<HTMLInputElement>('#password', form);
    const fields: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email?.value.trim() ?? '')) fields.email = copy.signup.emailInvalid;
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username?.value ?? '')) fields.username = copy.signup.usernameInvalid;
    const passwordValue = password?.value ?? '';
    if (passwordValue.length < 10 || passwordValue.length > 128) fields.password = copy.signup.passwordInvalid;
    if (Object.keys(fields).length > 0) {
      applyFieldErrors(form, fields);
      return;
    }

    const button = submitButton(form);
    if (button) {
      button.textContent = copy.signup.pending;
      button.disabled = true;
    }
    void (async () => {
      const result = await request<{ email: string }>('/api/auth/signup', {
        method: 'POST',
        body: { email: email?.value.trim(), username: username?.value, password: passwordValue },
      });
      if (button) {
        button.textContent = 'Create account';
        button.disabled = false;
      }
      if (!result.ok) {
        applyFieldErrors(form, result.error?.fields ?? {});
        return;
      }
      form.hidden = true;
      if (done) {
        done.hidden = false;
        done.innerHTML = `<h2>${copy.signup.heading}</h2><p>${copy.signup.sent(
          result.data?.email ?? '',
        )}</p><button type="button" data-resend-verification>Resend email</button>`;
      }
      showUnverifiedBanner();
      announce(copy.signup.heading);
    })();
  });
}

function initLogin(): void {
  const form = qs<HTMLFormElement>('[data-login]');
  if (!form) return;
  const totpStep = qs<HTMLElement>('[data-totp-step]', form);

  on(form, 'submit', (event) => {
    event.preventDefault();
    const login = qs<HTMLInputElement>('#login', form);
    const password = qs<HTMLInputElement>('#password', form);
    const totp = qs<HTMLInputElement>('#totp', form);
    const button = submitButton(form);
    if (button) {
      button.textContent = copy.signin.pending;
      button.disabled = true;
    }
    void (async () => {
      const result = await request<{ username: string }>('/api/auth/login', {
        method: 'POST',
        body: {
          login: login?.value.trim(),
          password: password?.value,
          totp: totp && totpStep && !totpStep.hidden ? totp.value.trim() : undefined,
        },
      });
      if (button) {
        button.textContent = totpStep && !totpStep.hidden ? 'Verify' : 'Sign in';
        button.disabled = false;
      }
      if (result.ok) {
        window.location.assign(page.next ?? '/');
        return;
      }
      const error = result.error;
      if (error?.code === 'TOTP_REQUIRED') {
        if (totpStep) totpStep.hidden = false;
        if (button) button.textContent = 'Verify';
        announce(copy.signin.codeRequired);
        totp?.focus();
        return;
      }
      if (error?.fields?.totp) {
        setFieldError(totp, error.fields.totp);
        totp?.focus();
        return;
      }
      if (error?.code === 'RATE_LIMITED') {
        alertAnnounce(copy.signin.lockedOut);
        return;
      }
      if (error?.code === 'SUSPENDED') {
        alertAnnounce(copy.signin.suspended);
        return;
      }
      alertAnnounce(copy.signin.incorrect);
    })();
  });
}

async function runVerify(): Promise<void> {
  if (page.route !== 'verify') return;
  const heading = qs<HTMLElement>('[data-verify-heading]');
  const body = qs<HTMLElement>('[data-verify-body]');
  const result = await request<{ emailVerified: boolean }>('/api/auth/verify', {
    method: 'POST',
    body: { token: page.token },
  });
  if (heading) heading.textContent = result.ok ? copy.verify.confirmed : copy.verify.expired;
  if (body && result.ok) body.innerHTML = '<p><a href="/">Go to your home feed</a></p>';
}

function initForgot(): void {
  const form = qs<HTMLFormElement>('[data-forgot]');
  if (!form) return;
  const done = qs<HTMLElement>('[data-forgot-done]');
  on(form, 'submit', (event) => {
    event.preventDefault();
    const email = qs<HTMLInputElement>('#email', form);
    const button = submitButton(form);
    if (button) button.textContent = copy.reset.pending;
    void (async () => {
      await request('/api/auth/password-reset', { method: 'POST', body: { email: email?.value.trim() } });
      if (button) button.textContent = 'Send reset link';
      form.hidden = true;
      if (done) {
        done.hidden = false;
        done.innerHTML = `<h2>${copy.signup.heading}</h2>`;
      }
      announce(copy.signup.heading);
    })();
  });
}

function initReset(): void {
  const form = qs<HTMLFormElement>('[data-reset]');
  if (!form) return;
  const done = qs<HTMLElement>('[data-reset-done]');
  on(form, 'submit', (event) => {
    event.preventDefault();
    const password = qs<HTMLInputElement>('#newPassword', form);
    const value = password?.value ?? '';
    if (value.length < 10 || value.length > 128) {
      applyFieldErrors(form, { newPassword: copy.signup.passwordInvalid });
      return;
    }
    const button = submitButton(form);
    if (button) button.textContent = copy.reset.pending;
    void (async () => {
      const result = await request('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: { token: page.token, newPassword: value },
      });
      if (button) button.textContent = 'Set new password';
      if (!result.ok) {
        const message = result.error?.fields?.token ?? result.error?.fields?.newPassword ?? copy.reset.expired;
        applyFieldErrors(form, { newPassword: message });
        alertAnnounce(message);
        return;
      }
      form.hidden = true;
      if (done) {
        done.hidden = false;
        done.innerHTML = `<h2>${copy.reset.updated}</h2><p><a href="/login">Sign in</a></p>`;
      }
      announce(copy.reset.updated);
    })();
  });
}

async function initTotpSetup(): Promise<void> {
  const form = qs<HTMLFormElement>('[data-totp]');
  const secretNode = qs<HTMLElement>('[data-totp-secret]');
  if (!form || !secretNode) return;
  const setup = await request<{ secret: string }>('/api/me/totp/setup', { method: 'POST' });
  if (setup.ok && setup.data) secretNode.textContent = setup.data.secret.toUpperCase();

  on(form, 'submit', (event) => {
    event.preventDefault();
    const code = qs<HTMLInputElement>('#code', form);
    void (async () => {
      const result = await request<{ totpEnabled: boolean }>('/api/me/totp/enable', {
        method: 'POST',
        body: { code: code?.value.trim() },
      });
      if (!result.ok) {
        applyFieldErrors(form, { code: result.error?.fields?.code ?? copy.totp.codeWrong });
        return;
      }
      announce(copy.totp.enabled);
      window.location.assign(page.next ?? '/settings');
    })();
  });
}

function initSignOut(): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-sign-out]')) {
      void request('/api/auth/logout', { method: 'POST' }).then(() => window.location.assign('/'));
      return;
    }
    if (target?.closest('[data-resend-verification]')) {
      void request('/api/auth/verify/resend', { method: 'POST' }).then((result) => {
        if (result.ok) announce(copy.verify.resent);
        else if (result.error?.code === 'RATE_LIMITED') alertAnnounce(copy.verify.resendLimited);
      });
    }
  });
}

export function initAccount(): void {
  initSignup();
  initLogin();
  initForgot();
  initReset();
  initSignOut();
  void runVerify();
  void initTotpSetup();
}
