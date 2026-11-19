import { h, clear, api, announce, statusRegion } from './dom';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function renderAccount(root: HTMLElement): void {
  clear(root);
  const wrap = h('main', { class: 'formpage' });
  const statusEl = statusRegion('Account status');
  const setMsg = (t: string): void => announce('Account status', t);

  const mkField = (id: string, labelText: string, type: string, errEl: HTMLElement, onenter?: () => void): HTMLInputElement => {
    const input = h('input', { id, type, name: labelText, 'aria-describedby': `${id}-err` }) as HTMLInputElement;
    input.setAttribute('aria-label', labelText);
    input.style.minHeight = '44px';
    input.style.border = '1.5px solid var(--line-2)';
    input.style.borderRadius = '12px';
    input.style.padding = '8px 12px';
    const label = h('label', { for: id }, labelText);
    const field = h('div', { class: 'field' }, label, input, errEl);
    void field;
    if (onenter) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); onenter(); } });
    return input;
  };
  const errFor = (id: string): HTMLElement => h('div', { id: `${id}-err`, class: 'err' });

  /* sign up */
  const suErrName = errFor('su-name'), suErrEmail = errFor('su-email'), suErrPass = errFor('su-pass');
  const suName = mkField('su-name', 'Name', 'text', suErrName);
  const suEmail = mkField('su-email', 'Email', 'email', suErrEmail);
  const suPass = mkField('su-pass', 'Password', 'password', suErrPass, () => void doSignup());
  const suBtn = h('button', { class: 'pill primary', onclick: () => void doSignup() }, 'Create account');
  const signup = h('section', { class: 'card' },
    h('h2', { class: 'h5' }, 'Sign up'),
    h('div', { class: 'stack' }, suName, suEmail, suPass, suBtn));

  /* verify */
  const vErr = errFor('v-code');
  const vEmail = mkField('v-email', 'Email', 'email', h('div', {}));
  const vCode = mkField('v-code', 'Verification code', 'text', vErr, () => void doVerify());
  const vBtn = h('button', { class: 'pill primary', onclick: () => void doVerify() }, 'Verify');
  const verify = h('section', { class: 'card' },
    h('h2', { class: 'h5' }, 'Verify'),
    h('div', { class: 'stack' }, vEmail, vCode, vErr, vBtn));

  /* sign in */
  const siErr = errFor('si-pass');
  const siEmail = mkField('si-email', 'Sign-in email', 'email', h('div', {}));
  const siPass = mkField('si-pass', 'Sign-in password', 'password', siErr, () => void doSignin());
  const siBtn = h('button', { class: 'pill primary', onclick: () => void doSignin() }, 'Sign in');
  const signin = h('section', { class: 'card' },
    h('h2', { class: 'h5' }, 'Sign in'),
    h('div', { class: 'stack' }, siEmail, siPass, siBtn));

  /* join */
  const jErr = errFor('j-code');
  const jCode = mkField('j-code', 'Team code', 'text', jErr, () => void doJoin());
  const jBtn = h('button', { class: 'pill primary', onclick: () => void doJoin() }, 'Join team');
  const join = h('section', { class: 'card' },
    h('h2', { class: 'h5' }, 'Join a team'),
    h('div', { class: 'stack' }, jCode, jErr, jBtn));

  const showErr = (el: HTMLElement, msg: string): void => {
    el.textContent = msg;
    const input = el.previousSibling as HTMLElement | null;
    if (input && input.tagName === 'INPUT') input.setAttribute('aria-invalid', 'true');
  };
  const clearErrs = (...els: HTMLElement[]): void => {
    for (const e of els) e.textContent = '';
    document.querySelectorAll('[aria-invalid]').forEach(x => x.removeAttribute('aria-invalid'));
  };

  const doSignup = async (): Promise<void> => {
    clearErrs(suErrName, suErrEmail, suErrPass);
    const name = suName.value.trim(), email = suEmail.value.trim(), pass = suPass.value;
    if (!name) { showErr(suErrName, 'Enter your name'); suName.focus(); return; }
    if (!EMAIL_RE.test(email)) { showErr(suErrEmail, 'Enter an email address like name@example.com'); suEmail.focus(); return; }
    if (pass.length < 8) { showErr(suErrPass, 'Use at least 8 characters'); suPass.focus(); return; }
    suBtn.setAttribute('aria-busy', 'true');
    const r = await api<{ email: string }>('POST', '/api/signup', { name, email, password: pass });
    suBtn.removeAttribute('aria-busy');
    if (r.status === 422 && r.data.errors) {
      const errs = r.data.errors;
      if (errs.name) { showErr(suErrName, errs.name); return; }
      if (errs.email) { showErr(suErrEmail, errs.email); return; }
      if (errs.password) { showErr(suErrPass, errs.password); return; }
    }
    if (r.ok) {
      vEmail.value = email;
      setMsg(`We sent a 6-digit code to ${email}`);
      vCode.focus();
    }
  };

  const doVerify = async (): Promise<void> => {
    clearErrs(vErr);
    const r = await api('POST', '/api/verify', { email: vEmail.value.trim(), code: vCode.value.trim() });
    if (r.status === 404) { showErr(vErr, 'That code is not right'); return; }
    if (r.status === 422) { showErr(vErr, 'That code is not right'); return; }
    if (r.ok) {
      setMsg('Email verified');
      jCode.focus();
    }
  };

  const doSignin = async (): Promise<void> => {
    clearErrs(siErr);
    const r = await api('POST', '/api/signin', { email: siEmail.value.trim(), password: siPass.value });
    if (r.status === 401) { showErr(siErr, 'Enter your sign-in details again'); siPass.focus(); return; }
    if (r.ok) { window.location.href = '/'; return; }
  };

  const doJoin = async (): Promise<void> => {
    clearErrs(jErr);
    const r = await api<{ name: string }>('POST', '/api/teams/join', { code: jCode.value.trim() });
    if (r.status === 403) { showErr(jErr, 'Verify your email before joining a team'); return; }
    if (r.status === 404) { showErr(jErr, 'That team code is not right'); return; }
    if (r.ok) { setMsg(`You joined ${r.data.name}`); window.location.href = '/'; }
  };

  wrap.append(signup, verify, signin, join);
  root.append(wrap);
  void statusEl;

  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');
  if (email) { suEmail.value = email; vEmail.value = email; siEmail.value = email; }
  if (params.get('mode') === 'join') jCode.focus();
  else suName.focus();
}
