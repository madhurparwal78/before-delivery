// The Airfold client: every screen, hook and interaction named by the brief.
import { App, firstLineOf, type AppSnapshot, type ComposedAttachment } from './app.js';
import { api, ApiError } from './api.js';
import { el, formatDate, formatTime, prefersReducedMotion, trapFocus } from './dom.js';
import { preparePhoto } from './photos.js';
import type { Conversation, Letter, LetterBody } from '../shared/types.js';

const app = new App();
let root: HTMLElement;
let shellRef: HTMLElement | null = null;
let lastRoute = '';
let renderSignature = '';
let sealDialogShownFor: string | null = null;
let attachmentPending: ComposedAttachment | null = null;
let attachmentPreparing: Promise<void> | null = null;

const POSTMARK_LABELS: Record<string, string> = {
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  returned: 'Returned: not collected in 30 days',
};

const AVAILABILITY_COPY: Record<string, string> = {
  available: 'Available',
  taken: 'Taken',
  length: 'Use 3 to 32 characters.',
  characters: 'Use only lowercase letters, numbers, underscores and dots.',
  first_character: 'Start with a letter.',
  last_character: "Don't end with a dot.",
};

function deliveryOf(letter: Letter, snapshot: AppSnapshot): 'sending' | 'sent' | 'delivered' | 'read' | 'failed' {
  const local = snapshot.localStates.get(letter.id);
  if (local === 'outbox' || local === 'uploading') return 'sending';
  if (local === 'failedUpload') return 'failed';
  if (letter.state === 'failed') return 'failed';
  return letter.state;
}

function postmarkLabel(letter: Letter, snapshot: AppSnapshot): string {
  const delivery = deliveryOf(letter, snapshot);
  if (delivery === 'failed' && letter.failure === 'returned') return POSTMARK_LABELS.returned;
  if (delivery === 'failed') return POSTMARK_LABELS.failed;
  return POSTMARK_LABELS[delivery];
}

function postmarkTime(letter: Letter, snapshot: AppSnapshot): string | null {
  const delivery = deliveryOf(letter, snapshot);
  if (delivery === 'sending' || delivery === 'failed') return null;
  if (delivery === 'sent') return letter.held_at;
  if (delivery === 'delivered') return letter.delivered_at;
  if (delivery === 'read') return letter.read_at;
  return letter.held_at;
}

/** A vector monogram or plain avatar, drawn in code. */
function plainAvatar(size = 44): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', '22');
  circle.setAttribute('cy', '22');
  circle.setAttribute('r', '22');
  circle.setAttribute('fill', 'var(--ink)');
  svg.append(circle);
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x', '22');
  text.setAttribute('y', '28');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '20');
  text.setAttribute('fill', 'var(--ground)');
  svg.append(text);
  const wrapper = el('span', { class: 'avatar', 'aria-hidden': 'true' });
  wrapper.append(svg);
  return wrapper;
}

function starMonogram(text: string): string {
  const initials = text.replace(/[^a-z0-9]/gi, ' ').trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || 'Hp';
}

function avatarWithPhoto(url: string, name: string, size = 44): HTMLElement {
  const wrapper = el('span', { class: 'avatar avatar-photo', 'aria-hidden': 'true' });
  const img = el('img', { src: url, alt: '' });
  wrapper.append(img);
  void name;
  void size;
  return wrapper;
}

function avatarFor(conversation: Conversation, snapshot: AppSnapshot, size = 44): HTMLElement {
  const cached = snapshot.profileCaches.get(conversation.peer.id);
  if (cached?.photoBlobId && !photoUrlCache.has(cached.photoBlobId)) {
    // The photo is served as a download; fetch, digest-check and unseal it in memory.
    const blobId = cached.photoBlobId;
    void loadPhotoObjectUrl(blobId, conversation, snapshot).then((url) => {
      if (url) photoUrlCache.set(blobId, url);
    });
  }
  const wrapper = el('span', { class: 'avatar-holder' });
  const url = cached?.photoBlobId ? photoUrlCache.get(cached.photoBlobId) : null;
  if (url) wrapper.append(avatarWithPhoto(url, conversation.peer.username, size));
  else {
    const svg = plainAvatar(size);
    svg.querySelector('text')!.textContent = starMonogram(conversation.peer.username);
    wrapper.append(svg);
  }
  return wrapper;
}

const photoUrlCache = new Map<string, string>();

async function loadPhotoObjectUrl(blobId: string, conversation: Conversation, snapshot: AppSnapshot): Promise<string | null> {
  const cached = photoUrlCache.get(blobId);
  if (cached) return cached;
  const keyRow = await (await import('./store.js')).getLetterBody(`profile:${conversation.peer.id}`);
  if (!keyRow || !snapshot.account) return null;
  try {
    const sealed = await api.downloadBlob(blobId);
    const { b64urlDecode, b64urlEncode } = await import('../shared/b64.js');
    const { digestOf, openAttachmentBytes, openProfilePayload } = await import('./identity.js');
    const profileKey = b64urlDecode(keyRow.body);
    const payload = await openProfilePayload(profileKey, conversation.peer.profile!.iv, conversation.peer.profile!.ciphertext);
    if (!payload.photo || payload.photo.blob_id !== blobId) return null;
    if (await digestOf(sealed) !== payload.photo.digest) return null;
    const bytes = await openAttachmentBytes(b64urlDecode(payload.photo.key), b64urlDecode(payload.photo.iv), sealed);
    const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' }));
    photoUrlCache.set(blobId, url);
    return url;
  } catch {
    return null;
  }
}

function conversationRow(conversation: Conversation, snapshot: AppSnapshot): HTMLElement {
  const name = app.peerName(conversation);
  const last = conversation.last_letter;
  const body = last ? snapshot.letterBodies.get(last.id) : undefined;
  const preview = last ? firstLineOf(body ?? undefined) || (last.attachment_id ? (body?.kind === 'file' ? 'File' : 'Photo') : 'Letters sealed before they leave') : null;
  const link = el('a', { class: 'conversation-row', href: `/letters/${conversation.id}`, dataset: { conversationId: conversation.id, testid: 'conversation-row' }, 'aria-label': `${name}, ${preview ?? 'No letters yet'}` });
  link.setAttribute('data-testid', 'conversation-row');
  link.setAttribute('aria-label', name);
  const avatar = avatarFor(conversation, snapshot);
  const main = el('span', { class: 'row-main' },
    el('span', { class: 'row-name', text: name }),
    el('span', { class: 'row-preview', text: preview ?? 'No letters yet' }),
  );
  const meta = el('span', { class: 'row-meta' },
    el('span', { class: 'row-time', text: last ? formatTime(last.held_at) : '' }),
    conversation.muted_until !== null ? el('span', { class: 'muted-mark', text: 'Muted' }) : null,
    conversation.unread > 0 ? unreadBadge(conversation.unread) : null,
  );
  link.append(avatar, main, meta);
  return link;
}

function unreadBadge(count: number): HTMLElement {
  const badge = el('span', { class: 'unread-badge', dataset: { testid: 'unread-badge' }, text: count > 99 ? '99+' : String(count) });
  badge.setAttribute('data-testid', 'unread-badge');
  return badge;
}

function requestRow(conversation: Conversation, snapshot: AppSnapshot): HTMLElement {
  const row = el('a', { class: 'conversation-row', href: `/requests/${conversation.id}`, dataset: { conversationId: conversation.id } });
  row.setAttribute('data-testid', 'request-row');
  row.setAttribute('aria-label', conversation.peer.username);
  const last = conversation.last_letter;
  const body = last ? snapshot.letterBodies.get(last.id) : undefined;
  const avatar = plainAvatar(44);
  avatar.querySelector('text')!.textContent = starMonogram(conversation.peer.username);
  row.append(
    avatar,
    el('span', { class: 'row-main' },
      el('span', { class: 'row-name', text: conversation.peer.username }),
      el('span', { class: 'row-preview', text: last ? firstLineOf(body ?? undefined) || 'Letters sealed before they leave' : 'Letter request' }),
    ),
    el('span', { class: 'row-meta' }, el('span', { class: 'row-time', text: last ? formatTime(last.held_at) : '' })),
  );
  return row;
}

function emptyState(text: string): HTMLElement {
  const sheet = el('div', { class: 'empty-sheet' }, el('p', { class: 'empty-copy', text }));
  sheet.setAttribute('data-testid', 'empty-state');
  return sheet;
}

// --- letters ---

function letterArticle(letter: Letter, snapshot: AppSnapshot, conversation: Conversation, isRequest: boolean): HTMLElement {
  const body = snapshot.letterBodies.get(letter.id);
  const mine = letter.sender_id === snapshot.account?.id;
  const delivery = deliveryOf(letter, snapshot);
  const article = el('article', {
    class: `letter ${mine ? 'letter-sent' : 'letter-received'}${letter.retracted_at ? ' letter-retracted' : ''}`,
    dataset: { letterId: letter.id, direction: mine ? 'sent' : 'received', delivery },
  });
  article.setAttribute('data-testid', 'letter');
  article.setAttribute('data-letter-id', letter.id);
  article.setAttribute('data-direction', mine ? 'sent' : 'received');
  article.setAttribute('data-delivery', delivery);

  if (letter.retracted_at) {
    article.append(el('p', { class: 'retracted-copy', text: mine ? 'You deleted this letter.' : 'This letter was deleted.' }));
    article.append(postmark(letter, snapshot));
    return article;
  }

  const content = el('div', { class: 'letter-content' });
  const failedUpload = delivery === 'failed' && snapshot.localStates.get(letter.id) === 'failedUpload' && letter.failure === null;
  if (failedUpload) {
    // A failed upload never posted: the copy shows above Retry upload, with no time.
    content.append(el('p', { class: 'upload-failed-copy', text: "Couldn't upload. Your letter wasn't sent." }));
    content.append(el('button', { class: 'btn', text: 'Retry upload', onclick: () => void app.retryUpload(letter.id) }));
  }
  if (body) {
    if (body.kind === 'text') {
      content.append(el('p', { class: 'letter-text', text: body.text }));
    } else if (body.kind === 'image') {
      if (body.text) content.append(el('p', { class: 'letter-text', text: body.text }));
      const previewAlt = mine ? 'Your photo' : `Photo from ${app.peerName(conversation)}`;
      const button = el('button', { class: 'photo-letter', onclick: () => void openPhoto(letter, body, mine, conversation) });
      button.setAttribute('aria-label', `Open photo`);
      const preview = el('span', { class: 'photo-preview', dataset: { testid: 'photo-preview' } });
      preview.setAttribute('data-testid', 'photo-preview');
      const img = el('img', { alt: previewAlt });
      img.setAttribute('alt', previewAlt);
      button.append(img, preview);
      content.append(button);
      void showPhotoInline(letter, body, mine, img, preview);
    } else if (body.kind === 'file') {
      const download = el('button', { class: 'file-letter', onclick: () => void downloadFile(letter, body) });
      download.textContent = `Download ${body.attachment.name}`;
      download.setAttribute('aria-label', `Download ${body.attachment.name}`);
      content.append(download);
    }
  }

  if (!isRequest && letter.class === 'letter') {
    const actions = el('button', {
      class: 'letter-actions-btn',
      'aria-label': 'Letter actions',
      onclick: () => openLetterActions(letter, conversation),
    });
    attachLongPress(actions, () => openLetterActions(letter, conversation));
    content.append(actions);
  }
  article.append(content, postmark(letter, snapshot));
  return article;
}

function postmark(letter: Letter, snapshot: AppSnapshot): HTMLElement {
  const label = postmarkLabel(letter, snapshot);
  const time = postmarkTime(letter, snapshot);
  const postmarkEl = el('span', { class: 'postmark', dataset: { testid: 'postmark' } });
  postmarkEl.setAttribute('data-testid', 'postmark');
  const labelEl = el('span', { class: 'postmark-label', text: label, dataset: { testid: 'postmark-label' } });
  labelEl.setAttribute('data-testid', 'postmark-label');
  postmarkEl.append(labelEl);
  if (time) {
    postmarkEl.append(el('time', { class: 'postmark-time', datetime: time, text: formatTime(time) }));
  }
  return postmarkEl;
}

function attachLongPress(target: HTMLElement, handler: () => void): void {
  let timer: number | null = null;
  target.addEventListener('pointerdown', () => {
    timer = window.setTimeout(() => {
      timer = null;
      handler();
    }, 500);
  });
  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointerleave', cancel);
  target.addEventListener('pointercancel', cancel);
}

async function showPhotoInline(letter: Letter, body: Extract<LetterBody, { kind: 'image' }>, mine: boolean, img: HTMLImageElement, preview: HTMLElement): Promise<void> {
  const result = await app.fetchAttachment(letter);
  if (result === 'corrupted' || result === 'unavailable') {
    if (result === 'corrupted') {
      preview.textContent = 'Attachment corrupted';
    } else {
      preview.textContent = "This attachment can't be opened right now.";
    }
    return;
  }
  // The blurred preview shows first, then the photo.
  if (body.attachment.thumb) {
    preview.style.backgroundImage = `url(data:image/jpeg;base64,${b64ToDataUrl(body.attachment.thumb)})`;
  }
  img.src = result.url;
  void mine;
}

function b64ToDataUrl(b64url: string): string {
  const normalized = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
}

let photoViewerClose: (() => void) | null = null;

async function openPhoto(letter: Letter, body: Extract<LetterBody, { kind: 'image' }>, mine: boolean, conversation: Conversation): Promise<void> {
  const alt = mine ? 'Your photo' : `Photo from ${app.peerName(conversation)}`;
  const dialog = el('div', { class: 'dialog-backdrop photo-viewer-backdrop' });
  const box = el('div', { class: 'dialog photo-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Photo viewer' });
  const img = el('img', { alt, class: 'photo-viewer-img' });
  const closeBtn = el('button', { class: 'btn btn-ink', text: 'Close photo', onclick: () => close() });
  box.append(img, closeBtn);
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) close();
  });
  const close = trapFocus(box, () => {
    dialog.remove();
    photoViewerClose = null;
  });
  photoViewerClose = close;
  document.body.append(dialog);
  const result = await app.fetchAttachment(letter);
  if (result === 'corrupted') {
    img.replaceWith(el('p', { class: 'corrupted-notice', text: 'Attachment corrupted' }));
  } else if (result === 'unavailable') {
    img.replaceWith(el('p', { class: 'corrupted-notice', text: "This attachment can't be opened right now." }));
  } else {
    img.src = result.url;
  }
  void body;
}

async function downloadFile(letter: Letter, body: Extract<LetterBody, { kind: 'file' }>): Promise<void> {
  const result = await app.fetchAttachment(letter);
  if (result === 'corrupted' || result === 'unavailable') {
    app.announce(result === 'corrupted' ? 'Attachment corrupted' : "This attachment can't be opened right now.");
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = result.url;
  anchor.download = body.attachment.name;
  anchor.click();
}

async function openLetterActions(letter: Letter, conversation: Conversation): Promise<void> {
  // Opening Letter actions refetches the letter so can_retract is exact.
  await app.refreshLetter(letter.id);
  const fresh = app.state.letters.get(letter.id);
  if (!fresh) return;
  const snapshot = app.state;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Letter actions' });
  const close = trapFocus(box, () => {
    dialog.remove();
  });
  const finish = (): void => {
    close();
  };
  const deleteForMe = el('button', {
    class: 'btn',
    text: 'Delete for me',
    onclick: () => {
      void app.deleteForMe(letter.id).then(() => {
        finish();
        showUndoSnackbar(letter.id);
      });
    },
  });
  box.append(deleteForMe);
  if (fresh.can_retract) {
    box.append(el('button', {
      class: 'btn',
      text: 'Delete for everyone',
      onclick: () => {
        void app.deleteForEveryone(letter.id).then(finish);
      },
    }));
  }
  box.append(el('button', { class: 'btn btn-quiet', text: 'Cancel', onclick: finish }));
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) finish();
  });
  document.body.append(dialog);
  void conversation;
  void snapshot;
  void opener;
}

function showUndoSnackbar(letterId: string): void {
  const existing = document.querySelector('[data-testid="snackbar"]');
  existing?.remove();
  const snackbar = el('div', { class: 'snackbar', dataset: { testid: 'snackbar' } });
  snackbar.setAttribute('data-testid', 'snackbar');
  const undo = el('button', { class: 'btn btn-ink', text: 'Undo', onclick: () => {
    void app.undoDeleteForMe(letterId);
    snackbar.remove();
    window.clearTimeout(timer);
  } });
  snackbar.append(el('span', { text: 'Letter deleted.' }), undo);
  document.body.append(snackbar);
  const undoMs = app.timers()?.undo_ms ?? 5000;
  const timer = window.setTimeout(() => snackbar.remove(), undoMs);
}

// --- landing ---

function landingScreen(): HTMLElement {
  const field = el('div', { class: 'field' });
  const monogram = el('a', { class: 'monogram', href: '/', 'aria-label': 'Halfpenny Post Co. Airfold' });
  const monogramSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  monogramSvg.setAttribute('viewBox', '0 0 44 44');
  monogramSvg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '22'); circle.setAttribute('cy', '22'); circle.setAttribute('r', '22');
  circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', 'var(--ink)');
  circle.setAttribute('stroke-width', '2');
  const hp = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  hp.setAttribute('x', '22'); hp.setAttribute('y', '29'); hp.setAttribute('text-anchor', 'middle');
  hp.setAttribute('font-size', '18'); hp.setAttribute('fill', 'var(--ink)');
  hp.textContent = 'Hp';
  monogramSvg.append(circle, hp);
  monogram.append(monogramSvg);

  const topLinks = el('nav', { class: 'top-links' },
    el('a', { href: '#how-sealing-works', text: 'How sealing works' }),
    el('a', { href: '#seal-numbers', text: 'Seal numbers' }),
    el('a', { href: '/signin', text: 'Sign in' }),
  );
  const join = el('a', { class: 'btn btn-ink join-btn', href: '/signup', text: 'Choose a username' });

  const hero = el('section', { class: 'hero-sheet', 'aria-label': 'Halfpenny Post' });
  const heading = el('h1', { class: 'hero-heading' },
    el('span', { class: 'hero-line hero-line-1', text: 'Letters that seal' }),
    el('span', { class: 'hero-line hero-line-2', text: 'themselves' }),
  );
  const diamonds = el('span', { class: 'hero-diamonds', 'aria-hidden': 'true', text: '◆ ◆' });
  const heroLines = el('p', { class: 'hero-lines' },
    el('span', { text: 'No phone number' }),
    el('span', { class: 'hero-diamond', text: '◆' }),
    el('span', { text: 'No email' }),
    el('span', { class: 'hero-diamond', text: '◆' }),
    el('span', { text: 'Sealed in your browser' }),
  );
  const postmarkRing = el('span', { class: 'hero-postmark', 'aria-hidden': 'true' },
    el('span', { class: 'hero-postmark-ring' }),
    el('span', { class: 'hero-postmark-text', text: "Halfpenny Post · held until you're back" }),
  );
  hero.append(heading, heroLines, diamonds, postmarkRing);

  const sectionOne = el('section', { class: 'landing-section', id: 'how-sealing-works' },
    el('h2', { text: 'How sealing works' }),
    el('p', { text: 'Your identity key is made in the browser and never leaves it. Every letter, photo, file, display name and filename is sealed before it leaves the page. The exchange holds sealed letters for an offline recipient until the recipient\'s browser collects them, records the delivery and then deletes its copy.' }),
  );
  const sectionTwo = el('section', { class: 'landing-section', id: 'seal-numbers' },
    el('h2', { text: 'Seal numbers' }),
    el('p', { text: 'Both people see the same 60-digit seal number, derived from the two identity keys. Compare it in person and mark the contact verified, and be stopped by a warning when a contact\'s key changes.' }),
  );
  const footer = el('footer', { class: 'back-flap' },
    el('p', { class: 'back-flap-return', text: 'Halfpenny Post Co. · Airfold · Sealed in your browser' }),
  );

  field.append(monogram, topLinks, join, hero, sectionOne, sectionTwo, footer);
  return field;
}

// --- sign-up ---

interface SignupDraft {
  username: string;
  recoveryCode: string | null;
  displayName: string;
  photo: File | null;
}

const signupDraft: SignupDraft = { username: '', recoveryCode: null, displayName: '', photo: null };

function signupScreen(): HTMLElement {
  const skipRecovery = new URLSearchParams(location.search).get('skip_recovery_check') === '1';
  const panel = el('div', { class: 'form-panel signup-panel' });
  const step = app.state.signupStep;
  if (step === 1) {
    const heading = el('h1', { text: 'Choose a username' });
    const intro = el('p', { class: 'muted', text: 'A username is all Airfold asks for. It can be changed later.' });
    const form = el('form', { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); void continueFromUsername(); } });
    const usernameInput = el('input', { class: 'input', id: 'signup-username', type: 'text', autocomplete: 'username', value: signupDraft.username });
    usernameInput.setAttribute('aria-label', 'Username');
    const chip = el('p', { class: 'chip', role: 'status', 'aria-live': 'polite', id: 'availability-chip' });
    chip.setAttribute('aria-label', 'Username availability');
    const chipText = el('span', { text: '' });
    chip.append(chipText);
    const usernameField = el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'signup-username', text: 'Username' }),
      usernameInput,
      chip,
    );
    usernameInput.addEventListener('input', () => {
      signupDraft.username = usernameInput.value;
      app.queueAvailability(usernameInput.value);
      renderChip(chipText, usernameInput.value);
    });
    const continueBtn = el('button', { class: 'btn btn-ink', type: 'submit', text: 'Continue' });
    form.append(usernameField, continueBtn);
    panel.append(heading, intro, form);
    window.setTimeout(() => usernameInput.focus(), 0);
    if (signupDraft.username) {
      app.queueAvailability(signupDraft.username);
      renderChip(chipText, signupDraft.username);
    }
  } else if (step === 2) {
    const heading = el('h1', { text: 'Your recovery code' });
    const intro = el('p', { class: 'muted', text: 'Write it down. It is the only way to restore your letters on a new browser. Airfold cannot show it again.' });
    const group = el('div', { class: 'recovery-group', role: 'group', 'aria-label': 'Your recovery code' });
    const code = el('p', { class: 'recovery-code', dataset: { testid: 'recovery-code' }, text: app.state.recoveryCode ?? signupDraft.recoveryCode ?? '' });
    code.setAttribute('data-testid', 'recovery-code');
    group.append(code);
    const form = el('form', { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); toRecoveryCheck(); } });
    const written = el('button', { class: 'btn btn-ink', type: 'submit', text: "I've written it down" });
    form.append(written);
    panel.append(heading, intro, group, form);
    window.setTimeout(() => written.focus(), 0);
  } else if (step === 3 && !skipRecovery) {
    panel.append(recoveryCheckPanel());
  } else {
    panel.append(profilePanel());
  }
  return panel;
}

function renderChip(chipText: HTMLElement, username: string): void {
  const update = (): void => {
    const availability = app.state.availability;
    if (!availability || availability.username.toLowerCase() !== username.toLowerCase() || availability.state === 'checking') {
      chipText.textContent = '';
      return;
    }
    if (availability.state === 'available') {
      chipText.textContent = 'Available';
      return;
    }
    chipText.textContent = AVAILABILITY_COPY[availability.reason ?? 'taken'] ?? '';
  };
  app.subscribeQuiet(update);
  update();
}

async function continueFromUsername(): Promise<void> {
  const availability = app.state.availability;
  const username = signupDraft.username.trim().toLowerCase();
  if (!username || !availability || availability.state !== 'available' || availability.username !== username) {
    return;
  }
  signupDraft.username = username;
  app.state.signupUsername = username;
  await app.prepareRecoveryCode();
  app.signupStepTo(2);
}

function toRecoveryCheck(): void {
  const skip = new URLSearchParams(location.search).get('skip_recovery_check') === '1';
  if (skip) {
    app.signupStepTo(4);
  } else {
    app.signupStepTo(3);
  }
}

function recoveryCheckPanel(): HTMLElement {
  const panel = el('div', {});
  const heading = el('h1', { text: 'Check your recovery code' });
  const intro = el('p', { class: 'muted', text: 'Type back three of its groups to confirm you have written it down.' });
  const code = app.state.recoveryCode ?? signupDraft.recoveryCode ?? '';
  const groups = code.split('-');
  const positions = [2, 5, 7].map((n) => n - 1);
  const form = el('form', { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); checkRecoveryGroups(); } });
  const fields: HTMLInputElement[] = [];
  const fieldset = el('div', { class: 'recovery-check-fields' });
  positions.forEach((position, index) => {
    const id = `recovery-group-${index}`;
    const input = el('input', { class: 'input recovery-group-input', id, type: 'text', maxlength: '4', autocomplete: 'off' });
    input.setAttribute('aria-label', `Group ${position + 1}`);
    fields.push(input);
    fieldset.append(input);
  });
  const errorEl = el('p', { class: 'tear-off', role: 'alert', text: '' });
  errorEl.style.display = 'none';
  const check = el('button', { class: 'btn btn-ink', type: 'submit', text: 'Check' });
  form.append(fieldset, errorEl, check);
  panel.append(heading, intro, form);
  window.setTimeout(() => fields[0]?.focus(), 0);
  return panel;

  function checkRecoveryGroups(): void {
    let firstWrong = -1;
    positions.forEach((position, index) => {
      if (fields[index].value.trim().toUpperCase() !== groups[position]) {
        if (firstWrong < 0) firstWrong = index;
      }
    });
    if (firstWrong >= 0) {
      errorEl.textContent = "That group doesn't match your recovery code.";
      errorEl.style.display = '';
      fields[firstWrong].focus();
      return;
    }
    errorEl.style.display = 'none';
    app.signupStepTo(4);
  }
}

function profilePanel(): HTMLElement {
  const panel = el('div', {});
  const heading = el('h1', { text: 'Your name' });
  const intro = el('p', { class: 'muted', text: 'A display name and an optional photo, both sealed before they leave this page.' });
  const form = el('form', { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); finishSignup(); } });
  const nameInput = el('input', { class: 'input', id: 'display-name', type: 'text', value: signupDraft.displayName });
  nameInput.setAttribute('aria-label', 'Display name');
  const nameError = el('p', { class: 'tear-off', role: 'alert', text: '' });
  nameError.style.display = 'none';
  nameInput.addEventListener('input', () => {
    signupDraft.displayName = nameInput.value;
    if (nameError.style.display !== 'none') {
      nameError.style.display = 'none';
      nameInput.removeAttribute('aria-describedby');
    }
  });
  const fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', id: 'photo-input' });
  fileInput.setAttribute('aria-label', 'Photo');
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    signupDraft.photo = fileInput.files?.[0] ?? null;
    addPhotoBtn.textContent = signupDraft.photo ? `Change photo` : 'Add a photo';
  });
  const addPhotoBtn = el('button', {
    class: 'btn',
    type: 'button',
    text: 'Add a photo',
    onclick: () => fileInput.click(),
  });
  const finish = el('button', { class: 'btn btn-ink', type: 'submit', text: 'Finish' });
  form.append(
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'display-name', text: 'Display name' }), nameInput, nameError),
    el('div', { class: 'field' }, addPhotoBtn, fileInput),
    finish,
  );
  panel.append(heading, intro, form);
  window.setTimeout(() => nameInput.focus(), 0);

  async function finishSignup(): Promise<void> {
    const name = signupDraft.displayName.trim();
    if (!name) {
      nameError.textContent = 'Enter a display name.';
      nameError.style.display = '';
      nameInput.setAttribute('aria-describedby', 'display-name-error');
      nameError.id = 'display-name-error';
      nameInput.focus();
      return;
    }
    finish.setAttribute('disabled', 'disabled');
    finish.setAttribute('aria-busy', 'true');
    const result = await app.signUp(signupDraft.username, name, signupDraft.photo);
    if (!result.ok) {
      finish.removeAttribute('disabled');
      finish.removeAttribute('aria-busy');
      if (result.field === 'username') {
        app.signupStepTo(1);
      }
    }
  }
  return panel;
}

// --- sign-in ---

function signinScreen(): HTMLElement {
  const panel = el('div', { class: 'form-panel' });
  const heading = el('h1', { text: 'Restore your account' });
  const intro = el('p', { class: 'muted', text: 'Enter your username and recovery code. This signs out every other browser.' });
  const form = el('form', { class: 'form', onsubmit: (event: Event) => { event.preventDefault(); void restore(); } });
  const usernameInput = el('input', { class: 'input', id: 'signin-username', type: 'text', autocomplete: 'username' });
  usernameInput.setAttribute('aria-label', 'Username');
  const codeInput = el('input', { class: 'input', id: 'signin-code', type: 'text', autocomplete: 'off' });
  codeInput.setAttribute('aria-label', 'Recovery code');
  const error = el('p', { class: 'tear-off', role: 'alert', text: '' });
  error.style.display = 'none';
  const restoreBtn = el('button', { class: 'btn btn-ink', type: 'submit', text: 'Restore account' });
  form.append(
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'signin-username', text: 'Username' }), usernameInput),
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'signin-code', text: 'Recovery code' }), codeInput),
    error,
    restoreBtn,
  );
  panel.append(heading, intro, form);
  window.setTimeout(() => usernameInput.focus(), 0);

  async function restore(): Promise<void> {
    const username = usernameInput.value.trim().toLowerCase();
    const code = codeInput.value.trim();
    if (!username || !code) return;
    restoreBtn.setAttribute('disabled', 'disabled');
    restoreBtn.setAttribute('aria-busy', 'true');
    const result = await app.signIn(username, code);
    restoreBtn.removeAttribute('disabled');
    restoreBtn.removeAttribute('aria-busy');
    if (!result.ok) {
      error.textContent = result.error === 'too_many' ? 'Too many tries. Wait a minute and try again.' : "That username and recovery code don't match.";
      error.style.display = '';
    }
  }
  return panel;
}

// --- signed out ---

function signedOutScreen(): HTMLElement {
  const panel = el('div', { class: 'form-panel' });
  panel.append(el('h1', { text: 'Signed out' }), el('p', { class: 'muted', text: 'This account was restored in another browser, so this browser is signed out.' }));
  return panel;
}

// --- app shell ---

function appShell(content: () => HTMLElement): HTMLElement {
  const shell = el('div', { class: 'shell' });
  const snapshot = app.state;
  const outageBanner = el('div', { class: 'outage-banner', role: 'alert' });
  const outageInner = el('div', { class: 'outage-banner-inner', dataset: { testid: 'outage-banner' }, text: snapshot.outage ? "Photos and files can't be sent or opened right now. Letters still go through." : '' });
  outageInner.setAttribute('data-testid', 'outage-banner');
  outageBanner.append(outageInner);
  outageBanner.style.display = snapshot.outage ? '' : 'none';

  const main = el('main', { class: 'main' }, content());
  const nav = el('nav', { class: 'tab-bar', 'aria-label': 'Main' });
  const unread = app.unreadTotal();
  const chatsLink = el('a', { class: 'tab-link', href: '/letters', 'aria-current': snapshot.route.startsWith('/letters') ? 'page' : undefined, text: 'Chats' });
  if (unread > 0) {
    chatsLink.setAttribute('data-testid', 'tab-unread-badge');
  }
  nav.append(
    chatsLink,
    el('a', { class: 'tab-link', href: '/contacts', 'aria-current': snapshot.route.startsWith('/contacts') ? 'page' : undefined, text: 'Contacts' }),
    el('a', { class: 'tab-link', href: '/settings', 'aria-current': snapshot.route.startsWith('/settings') ? 'page' : undefined, text: 'Settings' }),
  );
  const bars = el('div', { class: 'connection-bars', role: 'status', 'aria-live': 'polite' });
  bars.setAttribute('aria-label', 'Connection');
  const connectingBar = el('div', { class: 'bar connecting-bar', dataset: { testid: 'connecting-bar' }, text: 'Connecting...' });
  connectingBar.setAttribute('data-testid', 'connecting-bar');
  connectingBar.style.display = snapshot.connection === 'connecting' ? '' : 'none';
  const updatingBar = el('div', { class: 'bar updating-bar', dataset: { testid: 'updating-bar' }, text: snapshot.updatingCount > 0 ? `Updating... ${snapshot.updatingCount} ${snapshot.updatingCount === 1 ? 'letter' : 'letters'}` : 'Updating...' });
  updatingBar.setAttribute('data-testid', 'updating-bar');
  updatingBar.style.display = snapshot.connection === 'updating' ? '' : 'none';
  bars.append(connectingBar, updatingBar);
  shell.append(outageBanner, bars, main, nav);
  shellRef = shell;
  return shell;
}

function updatesRegion(): HTMLElement {
  const region = el('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  region.setAttribute('aria-label', 'Letter updates');
  const live = el('span', { 'data-live': '0' });
  region.append(live);
  app.setUpdatesRegion(region);
  return region;
}

function notificationsRegion(): HTMLElement {
  const region = el('div', { class: 'toasts-region', role: 'status', 'aria-live': 'polite' });
  region.setAttribute('aria-label', 'Notifications');
  for (const toast of app.state.toasts) {
    const toastEl = el('button', { class: 'toast', dataset: { testid: 'toast' }, text: toast.text, onclick: () => {
      app.dismissToast(toast.id);
      if (toast.conversationId) app.navigate(`/letters/${toast.conversationId}`);
    } });
    toastEl.setAttribute('data-testid', 'toast');
    region.append(toastEl);
  }
  return region;
}

// --- chats ---

function chatsScreen(): HTMLElement {
  const snapshot = app.state;
  const section = el('section', { class: 'list-pane pane' });
  const heading = el('h1', { class: 'pane-heading', text: 'Chats' });
  const requestsCount = snapshot.requests.length;
  if (requestsCount > 0) {
    section.append(el('a', { class: 'requests-link', href: '/requests', text: `Letter requests (${requestsCount})` }));
  }
  const list = el('ul', { class: 'conversation-list', 'aria-label': 'Conversations' });
  list.setAttribute('role', 'list');
  if (snapshot.conversations.length === 0) {
    list.append(el('li', { class: 'conversation-item conversation-item-empty' }, emptyState('No letters yet. Find someone by their exact username.')));
  } else {
    for (const conversation of snapshot.conversations) {
      const item = el('li', { class: 'conversation-item' });
      item.append(conversationRow(conversation, snapshot));
      list.append(item);
    }
  }
  section.append(heading, list);
  return section;
}

function requestsScreen(): HTMLElement {
  const snapshot = app.state;
  const section = el('section', { class: 'list-pane pane' });
  const list = el('ul', { class: 'conversation-list', 'aria-label': 'Letter requests' });
  list.setAttribute('role', 'list');
  if (snapshot.requests.length === 0) {
    list.append(el('li', { class: 'conversation-item conversation-item-empty' }, emptyState('No letter requests.')));
  } else {
    for (const conversation of snapshot.requests) {
      list.append(el('li', { class: 'conversation-item' }, requestRow(conversation, snapshot)));
    }
  }
  section.append(el('h1', { class: 'pane-heading', text: 'Letter requests' }), list);
  return section;
}

function openRequestScreen(conversationId: string): HTMLElement {
  const snapshot = app.state;
  void app.loadRequestLetters(conversationId);
  const conversation = snapshot.requests.find((c) => c.id === conversationId) ?? null;
  const section = el('section', { class: 'sheet-pane pane' });
  if (!conversation) {
    section.append(el('h1', { class: 'pane-heading', text: 'Letter request' }), emptyState('We couldn\'t find that letter.'));
    return section;
  }
  const region = el('div', { class: 'open-request', role: 'region', 'aria-label': 'Letter request' });
  region.append(el('h2', { class: 'sheet-heading', text: conversation.peer.username }));
  const letters = lettersOfConversation(conversationId, conversation, true);
  region.append(letters);
  const actions = el('div', { class: 'request-actions' },
    el('button', { class: 'btn btn-ink', text: 'Accept', onclick: () => { void app.acceptRequest(conversation).then(() => app.navigate(`/letters/${conversation.id}`)); } }),
    el('button', { class: 'btn', text: 'Delete', onclick: () => { void app.deleteRequest(conversation).then(() => app.navigate('/letters')); } }),
    el('button', { class: 'btn', text: 'Block', onclick: () => blockDialog(conversation) }),
  );
  region.append(actions);
  section.append(region);
  return section;
}

function lettersOfConversation(conversationId: string, conversation: Conversation, isRequest: boolean): HTMLElement {
  const snapshot = app.state;
  const letters = [...snapshot.letters.values()]
    .filter((l) => l.conversation_id === conversationId && l.class === 'letter')
    .filter((l) => !hiddenIds.has(l.id))
    .sort((a, b) => a.seq - b.seq);
  const outboxLetters = [...snapshot.localStates.entries()]
    .filter(([id, state]) => state !== 'failedUpload' || true)
    .filter(([id]) => !snapshot.letters.has(id))
    .map(([id]) => id);
  const list = el('div', { class: 'letters', role: 'list', 'aria-label': 'Letters' });
  list.setAttribute('role', 'list');
  if (letters.length === 0 && outboxLetters.length === 0) {
    list.append(emptyState("Nothing written yet. Your first letter is sealed before it leaves this page."));
  }
  for (const letter of letters) {
    list.append(letterArticle(letter, snapshot, conversation, isRequest));
  }
  for (const id of outboxLetters) {
    const stub = localLetterStub(id, snapshot, conversation, isRequest);
    if (stub) list.append(stub);
  }
  return list;
}

let hiddenIds = new Set<string>();

function localLetterStub(id: string, snapshot: AppSnapshot, conversation: Conversation, isRequest: boolean): HTMLElement | null {
  const body = snapshot.letterBodies.get(id);
  if (!body) return null;
  const state = snapshot.localStates.get(id) ?? 'outbox';
  const fake: Letter = {
    id,
    conversation_id: conversation.id,
    seq: Number.MAX_SAFE_INTEGER,
    sender_id: snapshot.account?.id ?? '',
    recipient_id: conversation.peer.id,
    class: 'letter',
    state: 'sent',
    failure: null,
    held_at: new Date().toISOString(),
    delivered_at: null,
    read_at: null,
    returned_at: null,
    retracted_at: null,
    can_retract: false,
    sender_key_id: '',
    recipient_key_id: conversation.peer.key_id,
    iv: null,
    ciphertext: null,
    attachment_id: null,
  };
  const article = letterArticle(fake, snapshot, conversation, isRequest);
  return article;
}

// --- conversation ---

function conversationScreen(): HTMLElement {
  const snapshot = app.state;
  const conversation = snapshot.openConversation;
  const pane = el('section', { class: 'sheet-pane pane' });
  if (!conversation) {
    // Only the finished check answers not-found; a load in progress shows nothing yet.
    if (!snapshot.openConversationMissing) return pane;
    pane.append(emptyState("We couldn't find that letter."));
    const back = el('a', { class: 'btn', href: '/letters', text: 'Back to letters' });
    back.setAttribute('aria-label', 'Back to letters');
    pane.prepend(back);
    return pane;
  }
  const name = app.peerName(conversation);
  const back = el('a', { class: 'btn back-link', href: '/letters', text: 'Back to letters' });
  back.setAttribute('aria-label', 'Back to letters');
  const header = el('header', { class: 'sheet-header' },
    el('h2', { class: 'sheet-heading', text: name }),
  );
  const contactCardBtn = el('button', { class: 'btn', text: 'Contact card', onclick: () => contactCardDialog(conversation) });
  contactCardBtn.setAttribute('aria-label', 'Contact card');
  const sealStatusEl = el('span', { class: 'seal-status' });
  const seal = conversation.peer.seal;
  if (seal === 'verified') {
    sealStatusEl.textContent = 'Verified';
    sealStatusEl.classList.add('seal-verified');
  } else if (seal === 'changed') {
    sealStatusEl.textContent = 'Seal number changed';
    sealStatusEl.classList.add('seal-changed');
  } else {
    sealStatusEl.textContent = 'Not verified';
    sealStatusEl.classList.add('seal-unverified');
  }
  header.append(sealStatusEl, contactCardBtn);
  const letters = lettersOfConversation(conversation.id, conversation, false);

  const keyChange = snapshot.keyChanges.has(conversation.peer.id) || conversation.peer.seal === 'changed'
    ? keyChangeStub(conversation)
    : null;

  let composer: HTMLElement;
  if (conversation.blocked) {
    composer = el('div', { class: 'composer blocked-composer' },
      el('p', { class: 'blocked-copy', text: `You blocked ${app.peerName(conversation)}.` }),
      el('button', { class: 'btn btn-ink', text: 'Unblock', onclick: () => { void app.unblockPeer(conversation); } }),
    );
  } else if (snapshot.requests.some((r) => r.id === conversation.id)) {
    composer = el('div', { class: 'composer request-composer' });
  } else {
    composer = composerElement(conversation);
  }
  const fold = el('div', { class: 'fold-line', 'aria-hidden': 'true' });
  pane.append(back, header, letters);
  if (keyChange) pane.append(keyChange);
  pane.append(fold, composer);
  return pane;
}

function keyChangeStub(conversation: Conversation): HTMLElement {
  const name = app.peerName(conversation);
  const stub = el('div', { class: 'key-change', role: 'region', 'aria-label': 'Seal number changed' });
  stub.setAttribute('data-testid', 'key-change-warning');
  stub.append(el('p', { text: `${name}'s seal number has changed. Letters to ${name} are paused until you accept the new seal number.` }));
  const compare = el('button', { class: 'btn', text: 'Compare seal numbers', onclick: () => void app.openSealDialog(conversation) });
  const accept = el('button', { class: 'btn btn-ink', text: 'Accept new seal number', onclick: () => {
    void app.acceptNewSeal(conversation).then(() => focusComposer());
  } });
  stub.append(compare, accept);
  return stub;
}

let composerRef: HTMLTextAreaElement | null = null;

function focusComposer(): void {
  // The composer is rebuilt by the render that follows; focus the fresh one.
  const attempt = (tries = 0): void => {
    const fresh = document.querySelector('.composer-input') as HTMLTextAreaElement | null;
    if (fresh) {
      fresh.focus();
      return;
    }
    if (tries < 30) requestAnimationFrame(() => attempt(tries + 1));
  };
  requestAnimationFrame(() => attempt());
}

function composerElement(conversation: Conversation): HTMLElement {
  const wrapper = el('div', { class: 'composer' });
  const pinned = el('div', { class: 'pinned-slip', 'aria-live': 'polite' });
  const textArea = el('textarea', { class: 'composer-input', rows: '3' });
  textArea.setAttribute('aria-label', 'Write a letter');
  textArea.placeholder = 'Write a letter';
  composerRef = textArea;
  const tooLong = el('p', { class: 'tear-off', role: 'alert', text: 'Letters can be up to 8,000 characters.' });
  tooLong.style.display = 'none';
  const sendBtn = el('button', { class: 'btn btn-ink', text: 'Send', onclick: () => void send() });
  sendBtn.setAttribute('aria-label', 'Send');
  const photoInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  photoInput.setAttribute('aria-label', 'Photo');
  photoInput.style.display = 'none';
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0] ?? null;
    photoInput.value = '';
    if (!file) return;
    sendBtn.setAttribute('disabled', 'disabled');
    sendBtn.setAttribute('aria-busy', 'true');
    attachmentPreparing = attachPhoto(file, pinned).finally(() => {
      sendBtn.removeAttribute('disabled');
      sendBtn.removeAttribute('aria-busy');
      attachmentPreparing = null;
    });
  });
  const fileInput = el('input', { type: 'file' });
  fileInput.setAttribute('aria-label', 'File');
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] ?? null;
    fileInput.value = '';
    if (!file) return;
    sendBtn.setAttribute('disabled', 'disabled');
    sendBtn.setAttribute('aria-busy', 'true');
    attachmentPreparing = attachFile(file, pinned).finally(() => {
      sendBtn.removeAttribute('disabled');
      sendBtn.removeAttribute('aria-busy');
      attachmentPreparing = null;
    });
  });
  const attachPhotoBtn = el('button', { class: 'btn', text: 'Attach photo', onclick: () => photoInput.click() });
  attachPhotoBtn.setAttribute('aria-label', 'Attach photo');
  const attachFileBtn = el('button', { class: 'btn', text: 'Attach file', onclick: () => fileInput.click() });
  attachFileBtn.setAttribute('aria-label', 'Attach file');

  textArea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  });
  textArea.addEventListener('input', () => {
    const length = [...textArea.value].length;
    if (length > 8000) {
      tooLong.style.display = '';
      sendBtn.setAttribute('disabled', 'disabled');
    } else {
      tooLong.style.display = 'none';
      sendBtn.removeAttribute('disabled');
    }
  });

  const controls = el('div', { class: 'composer-controls' }, attachPhotoBtn, attachFileBtn, sendBtn);
  wrapper.append(pinned, textArea, tooLong, controls, photoInput, fileInput);

  let sealing = false;
  async function send(): Promise<void> {
    if (sealing) return; // A second tap while sealing does nothing.
    if (attachmentPreparing) await attachmentPreparing;
    const text = textArea.value;
    if (!text.trim() && !attachmentPending) return;
    sealing = true;
    const attachment = attachmentPending;
    try {
      await foldAndSend(textArea, wrapper, conversation, text, attachment);
      attachmentPending = null;
      pinned.textContent = '';
    } finally {
      sealing = false;
      focusComposer();
    }
  }
  return wrapper;
}

async function foldAndSend(textArea: HTMLTextAreaElement, wrapper: HTMLElement, conversation: Conversation, text: string, attachment: ComposedAttachment | null): Promise<void> {
  // The fold and postmark signature (DP-42). Reduced motion replaces it with a short fade (DP-43).
  const reduced = prefersReducedMotion();
  textArea.value = '';
  if (reduced) {
    wrapper.classList.add('composer-fading');
    window.setTimeout(() => {
      const fresh = document.querySelector('.composer');
      fresh?.classList.remove('composer-fading');
    }, 120);
    await app.compose(conversation, text, attachment);
    return;
  }
  // The fold sits at the document level, positioned over the composer, so a render
  // cannot detach it mid-sequence.
  const composerBox = wrapper.getBoundingClientRect();
  const fold = el('div', { class: 'fold-animation', 'aria-hidden': 'true' });
  fold.style.position = 'fixed';
  fold.style.left = `${composerBox.left}px`;
  fold.style.width = `${composerBox.width}px`;
  fold.style.top = `${composerBox.top}px`;
  const lower = el('div', { class: 'fold-third fold-lower' });
  const upper = el('div', { class: 'fold-third fold-upper' });
  const flap = el('div', { class: 'fold-flap' });
  fold.append(lower, upper, flap);
  document.body.append(fold);
  window.setTimeout(() => fold.classList.add('fold-stage-1'), 0);
  window.setTimeout(() => fold.classList.add('fold-stage-2'), 125);
  window.setTimeout(() => fold.classList.add('fold-stage-3'), 450);
  window.setTimeout(() => fold.classList.add('fold-stage-4'), 650);
  window.setTimeout(() => fold.remove(), 1200);
  await app.compose(conversation, text, attachment);
}

async function attachPhoto(file: File | null, pinned: HTMLElement): Promise<void> {
  if (!file) return;
  if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') {
    pinned.textContent = 'Choose a JPEG, PNG or WebP photo.';
    return;
  }
  const prepared = await preparePhoto(file);
  const sealedSize = prepared.bytes.length + 16;
  if (sealedSize > app.attachmentMaxBytes()) {
    pinned.textContent = `This file is larger than ${app.limitLabel()} and can't be sent.`;
    return;
  }
  attachmentPending = { kind: 'image', name: file.name, type: prepared.type, bytes: prepared.bytes, width: prepared.width, height: prepared.height, thumb: prepared.thumb };
  pinned.textContent = `Photo attached: ${file.name}`;
}

async function attachFile(file: File | null, pinned: HTMLElement): Promise<void> {
  if (!file) return;
  const sealedSize = file.size + 16;
  if (sealedSize > app.attachmentMaxBytes()) {
    pinned.textContent = `This file is larger than ${app.limitLabel()} and can't be sent.`;
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  attachmentPending = { kind: 'file', name: file.name, type: file.type || 'application/octet-stream', bytes };
  pinned.textContent = `File attached: ${file.name}`;
}

// --- contacts ---

function contactsScreen(): HTMLElement {
  const snapshot = app.state;
  const section = el('section', { class: 'list-pane pane' });
  section.append(el('h1', { class: 'pane-heading', text: 'Contacts' }));
  const form = el('form', { class: 'lookup-form', onsubmit: (event: Event) => { event.preventDefault(); void app.runLookup(input.value); } });
  const input = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  input.setAttribute('aria-label', 'Find by username');
  const find = el('button', { class: 'btn btn-ink', type: 'submit', text: 'Find' });
  find.setAttribute('aria-label', 'Find');
  const status = el('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', text: '' });
  status.setAttribute('aria-label', 'Lookup status');
  form.append(input, find, status);
  section.append(form);
  const result = el('div', { class: 'lookup-result', role: 'region', 'aria-label': 'Lookup result' });
  if (snapshot.lookup) {
    if (snapshot.lookup.status === 'found' && snapshot.lookup.found) {
      const found = snapshot.lookup.found;
      result.append(
        el('p', { class: 'lookup-username', text: found.username }),
        el('button', {
          class: 'btn btn-ink',
          text: 'Write a letter',
          onclick: () => {
            void app.startConversation(found.id).then((conversation) => {
              if (conversation) focusComposer();
            });
          },
        }),
      );
    } else if (snapshot.lookup.status === 'notfound') {
      result.append(el('p', { class: 'muted', text: 'No one with that username.' }));
    }
  }
  section.append(result);
  const list = el('ul', { class: 'conversation-list', 'aria-label': 'Contacts' });
  list.setAttribute('role', 'list');
  if (snapshot.conversations.length === 0) {
    list.append(el('li', { class: 'conversation-item conversation-item-empty' }, emptyState('No contacts yet.')));
  } else {
    for (const conversation of snapshot.conversations) {
      const item = el('li', { class: 'conversation-item' }, conversationRow(conversation, snapshot));
      list.append(item);
    }
  }
  section.append(list);
  window.setTimeout(() => {
    if (snapshot.lookup && (snapshot.lookup.status === 'found' || snapshot.lookup.status === 'notfound')) {
      result.setAttribute('tabindex', '-1');
      result.focus();
      status.textContent = snapshot.lookup.status === 'found' ? `Found ${snapshot.lookup.found?.username}.` : 'No one with that username.';
    }
  }, 0);
  return section;
}

// --- settings ---

function settingsScreen(): HTMLElement {
  const snapshot = app.state;
  const section = el('section', { class: 'settings-pane pane' });
  section.append(el('h1', { class: 'pane-heading', text: 'Settings' }));

  // Profile panel
  const profilePanel = el('div', { class: 'form-panel' });
  profilePanel.append(el('h2', { class: 'panel-heading', text: 'Profile' }));
  const cachedName = snapshot.profileCaches.get(snapshot.account?.id ?? '')?.displayName ?? '';
  const displayNameInput = el('input', { class: 'input', type: 'text', value: cachedName });
  displayNameInput.setAttribute('aria-label', 'Display name');
  const photoInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  photoInput.setAttribute('aria-label', 'Photo');
  photoInput.style.display = 'none';
  let photoChoice: File | null = null;
  const addPhotoBtn = el('button', { class: 'btn', type: 'button', text: 'Add a photo', onclick: () => photoInput.click() });
  photoInput.addEventListener('change', () => {
    photoChoice = photoInput.files?.[0] ?? null;
    addPhotoBtn.textContent = photoChoice ? 'Change photo' : 'Add a photo';
  });
  const profileError = el('p', { class: 'tear-off', role: 'alert', text: '' });
  profileError.style.display = 'none';
  const saveBtn = el('button', {
    class: 'btn btn-ink',
    text: 'Save profile',
    onclick: async () => {
      const name = displayNameInput.value.trim();
      if (!name) {
        profileError.textContent = 'Enter a display name.';
        profileError.style.display = '';
        return;
      }
      saveBtn.setAttribute('disabled', 'disabled');
      await app.saveProfile(name, photoChoice);
      saveBtn.removeAttribute('disabled');
      photoChoice = null;
      addPhotoBtn.textContent = 'Add a photo';
    },
  });
  saveBtn.setAttribute('aria-label', 'Save profile');
  profilePanel.append(
    el('div', { class: 'field' }, el('label', { class: 'field-label', text: 'Display name' }), displayNameInput, profileError),
    el('div', { class: 'field' }, addPhotoBtn, photoInput),
    saveBtn,
  );
  section.append(profilePanel);

  // Username panel
  const usernamePanel = el('div', { class: 'form-panel' });
  usernamePanel.append(el('h2', { class: 'panel-heading', text: 'Username' }), el('p', { class: 'muted', text: `Your username is ${snapshot.account?.username ?? ''}. You can change it once every 7 days.` }));
  const usernameInput = el('input', { class: 'input', type: 'text', autocomplete: 'off' });
  usernameInput.setAttribute('aria-label', 'New username');
  const chip = el('p', { class: 'chip', role: 'status', 'aria-live': 'polite', id: 'settings-availability-chip' });
  chip.setAttribute('aria-label', 'Username availability');
  const chipText = el('span', { text: '' });
  chip.append(chipText);
  usernameInput.addEventListener('input', () => {
    app.queueAvailability(usernameInput.value);
    renderSettingsChip(chipText, usernameInput.value);
  });
  const usernameError = el('p', { class: 'tear-off', role: 'alert', text: '' });
  usernameError.style.display = 'none';
  const changeBtn = el('button', {
    class: 'btn btn-ink',
    text: 'Change username',
    onclick: async () => {
      const username = usernameInput.value.trim().toLowerCase();
      if (!username) return;
      changeBtn.setAttribute('disabled', 'disabled');
      const result = await app.changeUsername(username);
      changeBtn.removeAttribute('disabled');
      if (result.ok) {
        usernameError.style.display = 'none';
        usernameInput.value = '';
        return;
      }
      if (result.error === 'cooldown') {
        usernameError.textContent = `You can change your username again on ${formatDate(result.retryAt ?? '')}.`;
        usernameError.style.display = '';
      } else if (result.error === 'taken') {
        usernameError.textContent = 'Taken';
        usernameError.style.display = '';
      } else if (result.error === 'same') {
        usernameError.textContent = "That's already your username.";
        usernameError.style.display = '';
      } else {
        usernameError.textContent = AVAILABILITY_COPY[result.error ?? 'characters'] ?? 'Something went wrong. Try again.';
        usernameError.style.display = '';
      }
    },
  });
  changeBtn.setAttribute('aria-label', 'Change username');
  usernamePanel.append(
    el('div', { class: 'field' }, el('label', { class: 'field-label', text: 'New username' }), usernameInput, chip, usernameError),
    changeBtn,
  );
  section.append(usernamePanel);

  // Receipts and preview panel
  const receiptPanel = el('div', { class: 'form-panel' });
  receiptPanel.append(el('h2', { class: 'panel-heading', text: 'Read receipts' }));
  const receiptsSwitch = el('input', { class: 'switch', type: 'checkbox', checked: snapshot.account?.settings.read_receipts ?? true });
  receiptsSwitch.setAttribute('aria-label', 'Read receipts');
  receiptsSwitch.setAttribute('role', 'switch');
  receiptsSwitch.addEventListener('change', () => {
    void app.saveSettings({ read_receipts: receiptsSwitch.checked });
  });
  receiptPanel.append(el('div', { class: 'field field-inline' }, el('label', { class: 'field-label', for: '', text: 'Read receipts' }), receiptsSwitch));
  receiptPanel.append(el('h2', { class: 'panel-heading', text: 'Notification preview' }));
  const previewGroup = el('div', { class: 'preview-group', role: 'radiogroup', 'aria-label': 'Notification preview' });
  const options: Array<{ value: 'name_and_letter' | 'name_only' | 'none'; label: string }> = [
    { value: 'name_and_letter', label: 'Name and letter' },
    { value: 'name_only', label: 'Name only' },
    { value: 'none', label: 'No name or letter' },
  ];
  for (const option of options) {
    const radio = el('input', { type: 'radio', name: 'preview', value: option.value, checked: (snapshot.account?.settings.preview ?? 'name_and_letter') === option.value });
    radio.setAttribute('aria-label', option.label);
    radio.addEventListener('change', () => {
      if (radio.checked) void app.saveSettings({ preview: option.value });
    });
    previewGroup.append(el('label', { class: 'radio-label' }, radio, el('span', { text: option.label })));
  }
  receiptPanel.append(previewGroup);
  section.append(receiptPanel);

  // Blocked contacts panel
  const blockedPanel = el('div', { class: 'form-panel' });
  blockedPanel.append(el('a', { class: 'panel-heading-link', href: '#blocked-contacts', text: 'Blocked contacts' }));
  const blockedList = el('ul', { class: 'blocked-list', id: 'blocked-contacts', 'aria-label': 'Blocked contacts' });
  blockedList.setAttribute('role', 'list');
  blockedPanel.append(blockedList);
  section.append(blockedPanel);
  void api.blocks().then(({ blocks }) => {
    blockedList.textContent = '';
    if (blocks.length === 0) {
      blockedList.append(emptyState("You haven't blocked anyone."));
      return;
    }
    for (const block of blocks) {
      const item = el('li', { class: 'blocked-item' });
      const unblock = el('button', { class: 'btn', text: `Unblock ${block.username}`, onclick: () => {
        void api.unblock(block.account_id).then(() => app.loadLists());
      } });
      unblock.setAttribute('aria-label', `Unblock ${block.username}`);
      item.append(el('span', { text: block.username }), unblock);
      blockedList.append(item);
    }
  });
  return section;
}

function renderSettingsChip(chipText: HTMLElement, username: string): void {
  const update = (): void => {
    const availability = app.state.availability;
    if (!availability || availability.username.toLowerCase() !== username.toLowerCase() || availability.state === 'checking') {
      chipText.textContent = '';
      return;
    }
    if (availability.state === 'available') {
      chipText.textContent = 'Available';
      return;
    }
    chipText.textContent = AVAILABILITY_COPY[availability.reason ?? 'taken'] ?? '';
  };
  app.subscribeQuiet(update);
  update();
}

// --- dialogs ---

function contactCardDialog(conversation: Conversation): void {
  const snapshot = app.state;
  const dialog = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Contact card' });
  const close = trapFocus(box, () => dialog.remove());
  const name = app.peerName(conversation);
  const card = el('div', { class: 'contact-card', role: 'region', 'aria-label': 'Contact card' });
  card.append(avatarFor(conversation, snapshot, 64));
  card.append(el('p', { class: 'contact-name', text: name }));
  card.append(el('p', { class: 'contact-username', text: conversation.peer.username }));
  const seal = conversation.peer.seal;
  const sealLine = el('p', { class: 'seal-status' });
  if (seal === 'verified') sealLine.textContent = 'Verified';
  else if (seal === 'changed') sealLine.textContent = 'Seal number changed';
  else sealLine.textContent = 'Not verified';
  card.append(sealLine);
  card.append(el('button', { class: 'btn', text: 'Show seal number', onclick: () => { close(); void app.openSealDialog(conversation); } }));
  const muteLabel = conversation.muted_until === null ? 'Mute' : 'Unmute';
  card.append(el('button', { class: 'btn', text: muteLabel, onclick: () => { close(); muteDialog(conversation); } }));
  const blockLabel = conversation.blocked ? 'Unblock' : 'Block';
  card.append(el('button', { class: 'btn', text: blockLabel, onclick: () => {
    close();
    if (conversation.blocked) void app.unblockPeer(conversation);
    else blockDialog(conversation);
  } }));
  const closeBtn = el('button', { class: 'btn btn-quiet', text: 'Close', onclick: () => close() });
  card.append(closeBtn);
  box.append(card);
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
}

function sealNumberDialog(): void {
  const state = app.state.sealDialog;
  if (!state) return;
  const conversation = state.conversation;
  const dialog = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Seal number' });
  const close = trapFocus(box, () => {
    dialog.remove();
    app.clearSealDialog();
    sealDialogShownFor = null;
  });
  const numberEl = el('p', { class: 'seal-number', dataset: { testid: 'seal-number' }, text: state.number });
  numberEl.setAttribute('data-testid', 'seal-number');
  box.append(el('h2', { class: 'dialog-heading', text: 'Seal number' }), numberEl);
  const verified = conversation.peer.seal === 'verified';
  const markBtn = el('button', {
    class: 'btn btn-ink',
    text: verified ? 'Remove verification' : 'Mark as verified',
    onclick: () => { close(); void app.markSealVerified(conversation, !verified); },
  });
  box.append(markBtn);
  box.append(el('button', { class: 'btn btn-quiet', text: 'Close', onclick: () => close() }));
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
}

function muteDialog(conversation: Conversation): void {
  const dialog = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Mute letters' });
  const close = trapFocus(box, () => dialog.remove());
  box.append(el('h2', { class: 'dialog-heading', text: 'Mute letters' }));
  const radios: Array<{ value: '1h' | '8h' | '1w' | 'always'; label: string }> = [
    { value: '1h', label: '1 hour' },
    { value: '8h', label: '8 hours' },
    { value: '1w', label: '1 week' },
    { value: 'always', label: 'Always' },
  ];
  let choice: '1h' | '8h' | '1w' | 'always' = '1h';
  for (const option of radios) {
    const radio = el('input', { type: 'radio', name: 'mute', value: option.value, checked: option.value === '1h' });
    radio.setAttribute('aria-label', option.label);
    radio.addEventListener('change', () => { if (radio.checked) choice = option.value; });
    box.append(el('label', { class: 'radio-label' }, radio, el('span', { text: option.label })));
  }
  const mute = el('button', { class: 'btn btn-ink', text: 'Mute', onclick: () => { close(); void app.setMute(conversation, choice); } });
  const cancel = el('button', { class: 'btn btn-quiet', text: 'Cancel', onclick: () => close() });
  box.append(mute, cancel);
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
}

function blockDialog(conversation: Conversation): void {
  const name = app.peerName(conversation);
  const dialog = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Block ${name}?` });
  const close = trapFocus(box, () => dialog.remove());
  box.append(el('h2', { class: 'dialog-heading', text: `Block ${name}?` }));
  box.append(el('p', { class: 'muted', text: `${name} won't be able to reach you. Letters they send while blocked are never delivered.` }));
  const block = el('button', { class: 'btn btn-ink', text: 'Block', onclick: () => { close(); void app.blockPeer(conversation); } });
  const cancel = el('button', { class: 'btn btn-quiet', text: 'Cancel', onclick: () => close() });
  box.append(block, cancel);
  dialog.append(box);
  dialog.addEventListener('pointerdown', (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
}

// --- rendering ---

function currentRoute(): string {
  const path = location.pathname;
  if (app.state.account === null) {
    if (path === '/signup') return 'signup';
    if (path === '/signin') return 'signin';
    if (app.state.signedOut) return 'signedout';
    return 'landing';
  }
  if (path.startsWith('/letters/')) return 'conversation';
  if (path === '/letters') return 'chats';
  if (path.startsWith('/requests/')) return 'request';
  if (path === '/requests') return 'requests';
  if (path === '/contacts') return 'contacts';
  if (path === '/settings') return 'settings';
  return 'chats';
}

function render(): void {
  const route = currentRoute();
  const snapshot = app.state;
  const lettersSig = [...snapshot.letters.values()].map((l) => `${l.id}:${l.state}:${l.retracted_at ?? ''}`).sort().join('|');
  const localSig = [...snapshot.localStates.entries()].map(([id, s]) => `${id}:${s}`).sort().join('|');
  const bodiesSig = [...snapshot.letterBodies.keys()].sort().join(',');
  const conversationsSig = snapshot.conversations.map((c) => `${c.id}:${c.unread}:${c.peer.seal}:${c.blocked}:${c.muted_until ?? ''}:${c.last_letter?.id ?? ''}:${c.peer.key_id}`).join('|');
  const requestsSig = snapshot.requests.map((c) => `${c.id}:${c.last_letter?.id ?? ''}`).join('|');
  const signature = [
    route,
    snapshot.lookup ? `${snapshot.lookup.status}:${snapshot.lookup.username}:${snapshot.lookup.found?.id ?? ''}` : '',
    String(snapshot.signupStep),
    String(snapshot.hiddenCount),
    String(snapshot.toasts.length),
    String(snapshot.signedOut),
    snapshot.recoveryCode ?? '',
    lettersSig,
    localSig,
    bodiesSig,
    conversationsSig,
    requestsSig,
    snapshot.account === null ? 'signedout' : (snapshot.account?.username ?? ''),
    snapshot.outage ? 'outage' : '',
    snapshot.connection,
    snapshot.openConversationId ?? '',
    snapshot.openConversation ? 'loaded' : (snapshot.openConversationMissing ? 'missing' : 'loading'),
    snapshot.sealDialog?.number ?? '',
    snapshot.updatingCount,
    [...snapshot.keyChanges].join(','),
    [...snapshot.profileCaches.entries()].map(([id, c]) => `${id}:${c.displayName ?? ''}:${c.photoBlobId ?? ''}`).sort().join(';'),
  ].join('~');
  if (signature === renderSignature) return;
  renderSignature = signature;
  hiddenIds = new Set();
  void app.hiddenLetterIds().then((ids) => {
    if (hiddenIds.size === 0 && ids.size > 0) {
      hiddenIds = ids;
      if (document.querySelector('.letters')) renderNow();
    }
  });
  renderNow();

  function renderNow(): void {
    const previousComposer = document.querySelector('.composer-input') as HTMLTextAreaElement | null;
    const previousText = previousComposer?.value ?? '';
    const previousFocus = previousComposer !== null && document.activeElement === previousComposer;
    const frame = el('div', { class: `frame frame-${route}` });
    if (route === 'landing') {
      frame.append(landingScreen());
    } else if (route === 'signup') {
      frame.append(signupScreen());
    } else if (route === 'signin') {
      frame.append(signinScreen());
    } else if (route === 'signedout') {
      frame.append(signedOutScreen());
    } else {
      const isWide = window.innerWidth >= 768;
      const showContactColumn = window.innerWidth >= 1200;
      let content: () => HTMLElement;
      if (route === 'chats' || route === 'conversation') {
        content = () => {
          const wrap = el('div', { class: `columns ${isWide ? 'columns-split' : 'columns-single'}` });
          wrap.append(chatsScreen());
          if (route === 'conversation') {
            // Under 768 px the list is hidden and the sheet replaces it.
            if (isWide) wrap.append(conversationScreen());
            else wrap.replaceChildren(conversationScreen());
          }
          if (showContactColumn) wrap.append(contactColumnPane());
          return wrap;
        };
      } else if (route === 'requests' || route === 'request') {
        content = () => {
          if (route === 'request') {
            const conversationId = location.pathname.slice('/requests/'.length);
            return el('div', { class: 'columns columns-single' }, requestsScreen(), openRequestScreen(conversationId));
          }
          return el('div', { class: 'columns columns-single' }, requestsScreen());
        };
      } else if (route === 'contacts') {
        content = () => el('div', { class: 'columns columns-single' }, contactsScreen());
      } else {
        content = () => el('div', { class: 'columns columns-single' }, settingsScreen());
      }
      frame.append(appShell(content));
    }
    frame.append(updatesRegion());
    frame.append(notificationsRegion());
    root.replaceChildren(frame);
    if (previousText && composerRef && !composerRef.value) {
      composerRef.value = previousText;
    }
    if (previousFocus && composerRef) composerRef.focus();
    if (app.state.sealDialog && !sealDialogShownFor) {
      sealDialogShownFor = app.state.sealDialog.number;
      sealNumberDialog();
    } else if (!app.state.sealDialog) {
      sealDialogShownFor = null;
    }
    lastRoute = route;
  }
}

function contactColumnPane(): HTMLElement {
  const snapshot = app.state;
  const conversation = snapshot.openConversation ?? snapshot.conversations[0] ?? null;
  const pane = el('section', { class: 'card-pane pane' });
  if (!conversation) {
    pane.append(el('h1', { class: 'pane-heading', text: 'Contact card' }), emptyState('No contacts yet.'));
    return pane;
  }
  const card = el('div', { class: 'contact-card standing-card', role: 'region', 'aria-label': 'Contact card' });
  card.append(avatarFor(conversation, snapshot, 64));
  card.append(el('p', { class: 'contact-name', text: app.peerName(conversation) }));
  card.append(el('p', { class: 'contact-username', text: conversation.peer.username }));
  const sealLine = el('p', { class: 'seal-status' });
  if (conversation.peer.seal === 'verified') sealLine.textContent = 'Verified';
  else if (conversation.peer.seal === 'changed') sealLine.textContent = 'Seal number changed';
  else sealLine.textContent = 'Not verified';
  card.append(sealLine);
  card.append(el('button', { class: 'btn', text: 'Show seal number', onclick: () => void app.openSealDialog(conversation) }));
  card.append(el('button', { class: 'btn', text: conversation.muted_until === null ? 'Mute' : 'Unmute', onclick: () => muteDialog(conversation) }));
  card.append(el('button', { class: 'btn', text: conversation.blocked ? 'Unblock' : 'Block', onclick: () => {
    if (conversation.blocked) void app.unblockPeer(conversation);
    else blockDialog(conversation);
  } }));
  pane.append(card);
  return pane;
}

// --- router ---

document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return;
  if (!(event.target instanceof HTMLElement)) return;
  const anchor = event.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('http')) return;
  event.preventDefault();
  history.pushState(null, '', href);
  if (href.startsWith('/letters/')) {
    const id = href.slice('/letters/'.length);
    app.state.openConversationId = id;
    app.navigate(href);
  } else {
    app.navigate(href);
  }
  render();
});

window.addEventListener('popstate', () => {
  app.navigate(location.pathname);
  render();
});

window.addEventListener('online', () => app.onBrowserOnline());
window.addEventListener('offline', () => app.onBrowserOffline());
window.addEventListener('resize', () => {
  if (lastRoute === 'conversation' || lastRoute === 'chats') render();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.state.openConversation) {
    void app.markReadUpTo(app.state.openConversation);
  }
});

// --- boot ---

root = document.getElementById('app') as HTMLElement;
app.subscribe(() => render());
void app.boot().then(() => {
  app.navigate(location.pathname);
  render();
  void app.restoreOutbox();
  if (app.state.account) void app.collectInbox(false);
});
