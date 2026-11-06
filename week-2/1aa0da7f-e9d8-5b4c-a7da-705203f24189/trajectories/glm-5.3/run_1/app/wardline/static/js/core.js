/* Wardline front-end core: session, dialogs, step-up, live regions. */

const WL = window.WL = {};

/* ---------- fetch helpers */

WL.bg = { 'X-Wardline-Background': '1' };

WL.api = async function (method, path, body, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (body !== undefined && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.background) Object.assign(headers, WL.bg);
  const init = { method: method, headers: headers, credentials: 'same-origin' };
  if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);
  const res = await fetch(path, init);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (e) { data = null; }
  }
  return { status: res.status, ok: res.ok, data: data, res: res };
};

/* ---------- copy constants (Feedback states) */

WL.copy = {
  signInFailed: 'Email or password is not right.',
  signInLocked: 'Too many attempts. Try again later.',
  sessionEnded: 'Your session has ended.',
  signInAgain: 'Your session has ended. Sign in to finish what you were doing.',
  accessEnded: 'Your access to this compartment has ended.',
  accessChanged: 'Your access to this compartment has changed to derivatives only.',
  noRecord: 'Choose a row to inspect it.',
  notFound: 'Nothing to show at this address.',
  storageDown: 'Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost.',
  mailDown: 'The mail relay is unreachable. Notices are held and will send when it returns.',
  noticeHeld: 'Notice held. It will send when the mail relay returns.',
  wrongStepUp: 'Password or code is not right.',
  stepUpLocked: 'Too many attempts. Try again later.',
  connectionLost: 'Connection lost. Press Register exhibit to try again; it will not create a second exhibit.',
  noCrypto: 'Cannot verify in this browser. Open Wardline over HTTPS or on this machine.',
};

WL.stateWords = {
  assembling: 'Assembling', submitted: 'Submitted', 'signed off': 'Signed off',
  rejected: 'Rejected', shared: 'Shared', withdrawn: 'Withdrawn',
};

/* ---------- app state */

WL.state = {
  user: null,
  sessionId: null,
  route: location.pathname,
  notices: { storage: 'up', mail: 'up' },
  timers: [],
};

WL.route = function () {
  return location.pathname;
};

WL.parseRoute = function (path) {
  const parts = path.replace(/^\/+|\/+$/g, '').split('/');
  return {
    top: parts[0] || '',
    id: parts[1] || null,
    sub: parts[2] || null,
  };
};

WL.ensureSignedIn = function () {
  return WL.state.user !== null;
};

WL.go = function (path) {
  history.pushState({}, '', path);
  WL.render();
};

WL.signOut = async function () {
  await WL.api('POST', '/api/sign-out', {});
  WL.state.user = null;
  location.href = '/sign-in';
};

/* ---------- live regions */

WL.setStatus = function (name, text, kind) {
  const el = document.querySelector(`[role="status"][aria-label="${name}"]`) ||
    WL.rendered.statusRegions[name];
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('vermilion-col', 'verified-col');
  if (kind === 'vermilion') el.classList.add('vermilion-col');
  if (kind === 'green') el.classList.add('verified-col');
};

WL.actionStatus = function (text, kind) { WL.setStatus('Action status', text, kind); };

/* ---------- dialogs (DP-53) */

WL.dialog = {
  stack: [],
  open: function (opts) {
    const dlg = document.createElement('dialog');
    dlg.setAttribute('aria-label', opts.name);
    const form = document.createElement('form');
    form.method = 'dialog';
    form.style.display = 'grid';
    form.style.gap = '8px';
    dlg.appendChild(form);
    if (opts.build) opts.build(form, dlg);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'stay') {
        WL.dialog.stack = WL.dialog.stack.filter((d) => d !== dlg);
        dlg.remove();
        if (opts.onClose) opts.onClose(dlg.returnValue);
      }
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      WL.dialog.close(dlg, 'cancel');
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') WL.dialog.trapTab(e, dlg);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        const confirm = dlg.querySelector('[data-confirm]');
        if (confirm) confirm.click();
      }
    });
    WL.dialog.stack.push(dlg);
    dlg.showModal();
    const first = opts.firstFocus ?
      dlg.querySelector(opts.firstFocus) :
      WL.dialog.firstEmptyField(dlg);
    if (first) first.focus();
    return dlg;
  },
  firstEmptyField: function (dlg) {
    const fields = dlg.querySelectorAll('input:not([type="hidden"]), textarea');
    for (const f of fields) {
      if (f.readOnly) continue;
      if (!f.value) return f;
    }
    return fields[0] || null;
  },
  close: function (dlg, result) {
    if (!dlg) return;
    const opener = dlg._opener;
    if (opener && document.contains(opener)) {
      dlg.returnValue = result || 'cancel';
      dlg.close();
      if (opener && document.contains(opener)) {
        (opener.focus || function () {}).call(opener);
      } else {
        WL.dialog.fallbackFocus(dlg);
      }
    } else {
      dlg.returnValue = result || 'cancel';
      dlg.close();
      WL.dialog.fallbackFocus(dlg);
    }
  },
  closeAll: function () {
    for (const dlg of WL.dialog.stack.slice()) {
      dlg._opener = null;
      dlg.close();
      dlg.remove();
    }
    WL.dialog.stack = [];
  },
  fallbackFocus: function () {
    const r = WL.parseRoute(WL.route());
    const pane = (r.top === 'exhibits' || r.top === 'releases') ?
      document.querySelector('.pane-inspector') : document.querySelector('.pane-docket');
    if (pane) pane.focus();
  },
  trapTab: function (e, dlg) {
    const focusables = Array.from(dlg.querySelectorAll(
      'button, input:not([type="hidden"]), textarea, select, [href], [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  },
};

/* ---------- step-up (DP-07) */

WL.stepUp = async function (opts) {
  // opts: {reason: bool, reasonLabel, minReason, onConfirm: async (reason, dlg) => void}
  const opener = document.activeElement;
  const dlg = WL.dialog.open({
    name: 'Step-up',
    build: (form, el) => {
      el._opener = opener;
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-label', 'Step-up status');
      form.appendChild(status);
      if (opts.reason) {
        const lbl = document.createElement('label');
        lbl.className = 'field-label';
        lbl.textContent = opts.reasonLabel || 'Reason';
        const ta = document.createElement('textarea');
        ta.setAttribute('aria-label', opts.reasonLabel || 'Reason');
        ta.name = 'reason';
        if (opts.reasonValue) ta.value = opts.reasonValue;
        lbl.appendChild(ta);
        form.appendChild(lbl);
        const err = document.createElement('div');
        err.className = 'field-error';
        err.dataset.for = 'reason';
        form.appendChild(err);
      }
      const pwLabel = document.createElement('label');
      pwLabel.className = 'field-label';
      pwLabel.textContent = 'Password';
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.setAttribute('aria-label', 'Password');
      pw.name = 'password';
      pwLabel.appendChild(pw);
      form.appendChild(pwLabel);
      const codeLabel = document.createElement('label');
      codeLabel.className = 'field-label';
      codeLabel.textContent = 'Authenticator code';
      const code = document.createElement('input');
      code.type = 'text';
      code.setAttribute('aria-label', 'Authenticator code');
      code.autocomplete = 'one-time-code';
      code.name = 'code';
      codeLabel.appendChild(code);
      form.appendChild(codeLabel);
      const row = document.createElement('div');
      row.className = 'actions-row';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.textContent = 'Confirm';
      confirm.setAttribute('data-confirm', 'true');
      confirm.addEventListener('click', async () => {
        status.textContent = '';
        const password = pw.value, codeVal = code.value;
        const res = await WL.api('POST', '/api/step-up', { password, code: codeVal });
        if (!res.ok) {
          if (res.data && res.data.error === 'sign_in_locked') {
            status.textContent = WL.copy.signInLocked;
            status.classList.add('vermilion-col');
          } else {
            status.textContent = WL.copy.wrongStepUp;
            status.classList.add('vermilion-col');
          }
          pw.value = ''; codeVal.length = 0; code.value = '';
          pw.focus();
          return;
        }
        if (opts.reason) {
          const reasonField = form.querySelector('textarea[name="reason"]');
          const err = form.querySelector('[data-for="reason"]');
          const value = reasonField.value;
          const check = opts.validateReason ? opts.validateReason(value) : null;
          if (check) {
            err.textContent = check;
            reasonField.setAttribute('aria-invalid', 'true');
            reasonField.focus();
            return;
          }
          err.textContent = '';
          reasonField.setAttribute('aria-invalid', 'false');
        }
        await opts.onConfirm(res.data.proof, dlg, form);
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.classList.add('ghost');
      cancel.addEventListener('click', () => WL.dialog.close(dlg, 'cancel'));
      row.appendChild(confirm);
      row.appendChild(cancel);
      form.appendChild(row);
    },
  });
  return dlg;
};

/* ---------- periodic checks (Sessions and update delays) */

WL.startChecks = function () {
  WL.state.timers.push(setInterval(WL.sessionCheck, 10000));
  WL.state.timers.push(setInterval(WL.statusCheck, 5000));
};

WL.sessionCheck = async function () {
  const res = await WL.api('GET', '/api/session', undefined, { background: true });
  if (res.status === 401) {
    WL.handleSessionEnded();
    return;
  }
  if (res.ok) {
    WL.state.user = res.data.user;
    WL.state.breakGlass = res.data.break_glass || [];
    if (WL.rendered.onSession) WL.rendered.onSession(res.data);
  }
};

WL.statusCheck = async function () {
  const res = await WL.api('GET', '/api/status', undefined, { background: true });
  if (res.ok) {
    WL.state.notices = res.data;
    WL.renderServiceNotice();
    if (WL.rendered.onStatus) WL.rendered.onStatus(res.data);
  }
};

WL.renderServiceNotice = function () {
  let el = document.getElementById('service-notice-slot');
  if (!el) return;
  const notices = [];
  if (WL.state.notices.storage === 'down') notices.push(WL.copy.storageDown);
  if (WL.state.notices.mail === 'down') notices.push(WL.copy.mailDown);
  if (!notices.length) {
    el.innerHTML = '';
    return;
  }
  if (!el.querySelector('[aria-label="Service notice"]')) {
    el.innerHTML = '';
    const alert = document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.setAttribute('aria-label', 'Service notice');
    alert.className = 'service-notice';
    el.appendChild(alert);
    for (const n of notices) {
      const p = document.createElement('div');
      p.textContent = n;
      alert.appendChild(p);
    }
  }
};

WL.handleSessionEnded = function () {
  if (WL.dialog.stack.length || WL.unsavedWork && WL.unsavedWork()) {
    WL.openSignInAgain();
  } else {
    const next = encodeURIComponent(WL.route());
    location.href = '/sign-in?next=' + next;
  }
};

WL.openSignInAgain = function () {
  if (document.querySelector('dialog[aria-label="Sign in again"]')) return;
  const dlg = WL.dialog.open({
    name: 'Sign in again',
    build: (form, el) => {
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      status.setAttribute('aria-label', 'Sign-in again status');
      status.textContent = WL.copy.signInAgain;
      form.appendChild(status);
      const eLabel = document.createElement('label');
      eLabel.className = 'field-label';
      eLabel.textContent = 'Email';
      const email = document.createElement('input');
      email.type = 'email';
      email.readOnly = true;
      email.value = WL.state.user ? WL.state.user.email : '';
      email.setAttribute('aria-label', 'Email');
      eLabel.appendChild(email);
      form.appendChild(eLabel);
      const pLabel = document.createElement('label');
      pLabel.className = 'field-label';
      pLabel.textContent = 'Password';
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.setAttribute('aria-label', 'Password');
      pLabel.appendChild(pw);
      form.appendChild(pLabel);
      const row = document.createElement('div');
      row.className = 'actions-row';
      const signIn = document.createElement('button');
      signIn.textContent = 'Sign in';
      signIn.addEventListener('click', async () => {
        status.textContent = 'Signing in.';
        const res = await WL.api('POST', '/api/sign-in', { email: email.value, password: pw.value });
        if (!res.ok) {
          const locked = res.data && res.data.error === 'sign_in_locked';
          status.textContent = locked ? WL.copy.signInLocked : WL.copy.signInFailed;
          status.classList.add('vermilion-col');
          pw.value = '';
          pw.focus();
          return;
        }
        WL.state.user = res.data.user;
        WL.dialog.close(dlg, 'ok');
        if (WL.afterReauth) WL.afterReauth();
      });
      const leave = document.createElement('button');
      leave.textContent = 'Leave page';
      leave.classList.add('ghost');
      leave.addEventListener('click', () => {
        const next = encodeURIComponent(WL.route());
        location.href = '/sign-in?next=' + next;
      });
      row.appendChild(signIn);
      row.appendChild(leave);
      form.appendChild(row);
      setTimeout(() => pw.focus(), 0);
    },
  });
  dlg.addEventListener('close', () => {}, { once: true });
};

WL.unsavedWork = function () { return false; };
WL.afterReauth = null;

/* ---------- boot */

WL.loadSession = async function () {
  const res = await WL.api('GET', '/api/session');
  if (res.ok) {
    WL.state.user = res.data.user;
    WL.state.sessionId = res.data.session_id;
    WL.state.breakGlass = res.data.break_glass || [];
    return true;
  }
  return false;
};

WL.render = function () {
  if (WL.renderer) WL.renderer();
};

WL.hmmText = function () { return ''; };
