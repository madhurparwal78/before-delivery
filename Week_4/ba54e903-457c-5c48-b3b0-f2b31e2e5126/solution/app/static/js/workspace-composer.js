/* The composer: sending, drafts, mentions, attachments and the time-out clock. */
import { S, $, h, icon, status, draftKey, UPLOAD_LIMITS } from './workspace-core.js';
import { submit } from './workspace-stream.js';

let field;
let pending = []; // File[]
let mentionItems = [];
let mentionIndex = 0;
let mentionStart = 0;
let nextCheck = 0; // performance.now() before which no expiry re-check starts

const PERMISSION_LINE = 'You do not have permission to send messages in this channel.';

function remainingMs() {
  return S.timeoutUntil === null ? 0 : S.timeoutUntil - window.Hub.serverNow();
}

export function timedOut() { return S.timeoutUntil !== null; }

export function composerName() {
  const channel = S.channels.find((c) => c.id === S.channelId);
  return `Message #${channel ? channel.name : ''}`;
}

/* Disabled and placeholder follow permissions and the server's clock, never the device clock alone. */
export function refreshComposer() {
  const canSend = S.perms.has('send_messages') && !timedOut();
  let placeholder = composerName();
  if (timedOut()) {
    const left = Math.max(0, Math.ceil(remainingMs() / 1000));
    placeholder = `You are timed out for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more.`;
  } else if (!S.perms.has('send_messages')) {
    placeholder = PERMISSION_LINE;
  }
  field.setAttribute('aria-label', composerName());
  if (field.getAttribute('placeholder') !== placeholder) field.setAttribute('placeholder', placeholder);
  if (field.disabled === canSend) field.disabled = !canSend;
  const attach = $('attach');
  const canAttach = canSend && S.perms.has('attach_files');
  if (attach.disabled === canAttach) attach.disabled = !canAttach;
  field.closest('.composer-row').classList.toggle('is-disabled', !canSend);
  if (!canSend) closeMentions();
}

function tick() {
  if (!timedOut()) return;
  refreshComposer();
  // Once the server's clock says the time-out is over, ask the server (it decides) at most once a second.
  if (remainingMs() <= 0 && performance.now() >= nextCheck) {
    nextCheck = performance.now() + 1000;
    S.hooks.refreshAccess();
  }
}

function resize() {
  field.style.height = 'auto';
  field.style.height = `${Math.min(field.scrollHeight, Math.round(innerHeight * 0.4))}px`;
}

function saveDraft() {
  const key = draftKey();
  try {
    if (field.value === '') sessionStorage.removeItem(key); else sessionStorage.setItem(key, field.value);
  } catch { /* storage unavailable: the draft stays in the field only */ }
}

export function restoreDraft() {
  let draft = null;
  try { draft = sessionStorage.getItem(draftKey()); } catch { draft = null; }
  field.value = draft || '';
  pending = [];
  renderPending();
  resize();
  field.setSelectionRange(field.value.length, field.value.length);
}

function send() {
  const body = field.value.trim();
  if (!body && pending.length === 0) return;
  const files = pending;
  pending = [];
  renderPending();
  field.value = '';
  saveDraft();
  resize();
  closeMentions();
  submit({ body, files });
}

/* ---------- attachments ---------- */

function renderPending() {
  const list = $('pending');
  list.replaceChildren(...pending.map((file) => h('li', {},
    h('span', { text: file.name }),
    h('button', { type: 'button', 'aria-label': `Remove ${file.name}`, onclick: () => {
      pending = pending.filter((x) => x !== file);
      renderPending();
      field.focus();
    } }, icon('x', 14)))));
  list.hidden = pending.length === 0;
}

function addFiles(files) {
  const limit = UPLOAD_LIMITS[S.me.tier] ?? UPLOAD_LIMITS.free;
  for (const file of files) {
    if (file.size > limit) status(`${file.name} is larger than your upload limit.`);
    else pending.push(file);
  }
  renderPending();
}

/* ---------- mentions ---------- */

function mentionContext() {
  const pos = field.selectionStart;
  const found = /(^|\s)@([A-Za-z0-9_.]*)$/.exec(field.value.slice(0, pos));
  return found ? { start: pos - found[2].length - 1, query: found[2].toLowerCase() } : null;
}

function closeMentions() {
  const list = $('mentions');
  if (list.hidden) return;
  list.hidden = true;
  list.replaceChildren();
  mentionItems = [];
  field.removeAttribute('aria-activedescendant');
}

function markActive() {
  Array.from($('mentions').children).forEach((li, i) => li.setAttribute('aria-selected', String(i === mentionIndex)));
  field.setAttribute('aria-activedescendant', `mention-${mentionIndex}`);
}

function updateMentions() {
  const context = mentionContext();
  if (!context || field.disabled) { closeMentions(); return; }
  mentionItems = S.members.map((m) => m.user)
    .filter((user) => user.username.toLowerCase().startsWith(context.query)).slice(0, 8);
  if (mentionItems.length === 0) { closeMentions(); return; }
  mentionStart = context.start;
  mentionIndex = 0;
  const list = $('mentions');
  list.replaceChildren(...mentionItems.map((user, i) => h('li', {
    role: 'option', id: `mention-${i}`, 'aria-selected': 'false', onmousedown: (event) => { event.preventDefault(); insertMention(i); },
  }, user.username, h('span', { class: 'sub', 'aria-hidden': 'true', text: user.display_name }))));
  list.hidden = false;
  markActive();
}

function insertMention(index) {
  const user = mentionItems[index];
  const pos = field.selectionStart;
  field.value = `${field.value.slice(0, mentionStart)}@${user.username} ${field.value.slice(pos)}`;
  const caret = mentionStart + user.username.length + 2;
  field.setSelectionRange(caret, caret);
  closeMentions();
  saveDraft();
  resize();
  field.focus();
}

/* ---------- wiring ---------- */

export function initComposer() {
  field = $('composer');
  $('attach').append(icon('clip'));
  const input = $('file-input');
  $('attach').addEventListener('click', () => input.click());
  input.addEventListener('change', () => { addFiles(Array.from(input.files)); input.value = ''; });
  field.addEventListener('input', () => { saveDraft(); resize(); updateMentions(); });
  field.addEventListener('click', updateMentions);
  field.addEventListener('blur', closeMentions);
  field.addEventListener('keydown', (event) => {
    const open = !$('mentions').hidden;
    if (open && event.key === 'ArrowDown') { event.preventDefault(); mentionIndex = Math.min(mentionItems.length - 1, mentionIndex + 1); markActive(); return; }
    if (open && event.key === 'ArrowUp') { event.preventDefault(); mentionIndex = Math.max(0, mentionIndex - 1); markActive(); return; }
    if (open && (event.key === 'Enter' || event.key === 'Tab')) { event.preventDefault(); insertMention(mentionIndex); return; }
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMentions(); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
  });
  $('composer-form').addEventListener('submit', (event) => { event.preventDefault(); send(); });
  setInterval(tick, 250);
}
