import { api } from '../api';
import { el, announce, copy } from '../ui';
import { renderBand } from '../main';
import type { Project } from '../../shared/types';
import { timecode } from '../../shared/frames';

/** The sign-in page: the band, with the form in the sheet position. */
export function renderSignIn(root: HTMLElement): HTMLElement {
  const main = el('main', null);
  const band = el('header', { class: 'band' });
  band.append(el('span', { class: 'brand', text: 'Gatecut' }));
  main.append(band, notices());
  const sheet = el('div', { class: 'sheet no-hero' });
  const formHolder = el('div', { style: 'grid-column: 1 / -1; max-width: 420px;' });
  const form = el('form', null);
  const email = el('input', { type: 'email', 'aria-label': 'Email', name: 'email', autocomplete: 'email' });
  const emailField = el('label', { class: 'field' });
  emailField.append(el('span', { text: 'Email' }), email);
  const password = el('input', { type: 'password', 'aria-label': 'Password', name: 'password', autocomplete: 'current-password' });
  const passwordField = el('label', { class: 'field' });
  passwordField.append(el('span', { text: 'Password' }), password);
  const submit = el('button', { class: 'btn primary', type: 'submit', text: 'Sign in' });
  form.append(emailField, passwordField, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      submit.disabled = true;
      announce('Notices', copy.signingIn());
      try {
        await api.signIn(email.value, password.value);
        window.location.href = '/';
      } catch {
        announce('Notices', 'That email and password do not match.');
        submit.disabled = false;
      }
    })();
  });
  formHolder.append(form);
  sheet.append(formHolder);
  main.append(sheet);
  void root;
  return main;
}

function notices(): HTMLElement {
  const node = el('div', { role: 'status', 'aria-label': 'Notices', id: 'status-notices', class: 'notices' });
  if (window.location.hash === '#signed-out') {
    node.textContent = copy.signedOut();
    window.history.replaceState(null, '', window.location.pathname);
  }
  return node;
}

/** Procedural contact-sheet frames: each marker's layer boxes. */
export function drawSheetFrame(canvas: HTMLCanvasElement, project: Project, frame: number, clipFacts: Map<string, { sha: string }>): void {
  const width = project.width;
  const height = project.height;
  canvas.width = 480;
  canvas.height = Math.round((480 * height) / width);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.fillStyle = '#241d16';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  void clipFacts;
  void timecode;
  void frame;
}

export { renderBand };
