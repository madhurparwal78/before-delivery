// The widget: a player's own help conversation.
import { el } from './publicPage';
import { announce, registerLiveRegion } from './announce';
import { renderFormatted } from './formatting';
import { formatAmount, formatTime } from './format';
import type { Attachment, MeBody, Message, ThreadBody } from './types';

const PLAYER_HEADERS = new Headers();
let widgetHeaders: Record<string, string> = {};

function widgetParams(): { game: string; player: string; sig: string } | null {
  const match = window.location.pathname.match(/^\/widget\/([^/]+)/);
  if (!match) return null;
  const params = new URLSearchParams(window.location.search);
  const player = params.get('player');
  const sig = params.get('sig');
  if (!player || !sig) return null;
  return { game: decodeURIComponent(match[1]), player, sig };
}

function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set('x-hushline-player', widgetHeaders.player);
  headers.set('x-hushline-player-signature', widgetHeaders.sig);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return fetch(path, { ...init, headers });
}

interface WidgetState {
  gameName: string;
  threadId: string | null;
  messages: Message[];
  bucket: { level: number; capacity: number; retry_after_seconds: number | null };
  retryAt: number | null;
  replyKey: string | null;
  pending: boolean;
  identityFailed: boolean;
}

const state: WidgetState = {
  gameName: '',
  threadId: null,
  messages: [],
  bucket: { level: 8, capacity: 8, retry_after_seconds: null },
  retryAt: null,
  replyKey: null,
  pending: false,
  identityFailed: false,
};

function newKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 24).replace(/[^A-Za-z0-9_-]/g, 'x');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function widgetPage(root: HTMLElement): Promise<void> {
  document.title = 'Help — Hushline';
  const params = widgetParams();
  const container = el('div', { class: 'widget' });
  const heading = el('h1', {}, 'Help');
  const announcements = el('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  registerLiveRegion('widget', announcements);

  const conversation = el('ul', { 'aria-label': 'Conversation', class: 'conversation' });
  const topicPicker = el('select', { 'aria-label': 'Topic' }) as HTMLSelectElement;
  topicPicker.append(
    el('option', { value: 'bug' }, 'Bug'),
    el('option', { value: 'account' }, 'Account'),
    el('option', { value: 'purchase' }, 'Purchase'),
    el('option', { value: 'other' }, 'Something else'),
  );
  const messageField = el('textarea', { 'aria-label': 'Message', rows: '4', placeholder: 'Message' }) as HTMLTextAreaElement;
  const fileInput = el('input', { type: 'file', 'aria-label': 'Attach a file', multiple: 'multiple' }) as HTMLInputElement;
  const pickedFiles = el('ul', { class: 'rule-list' });
  const sendButton = el('button', { type: 'button', class: 'accent' }, 'Send');

  container.append(heading, announcements, conversation, topicPicker, messageField, fileInput, pickedFiles, sendButton);
  root.append(container);

  if (!params) {
    announce('widget', "This help window couldn't confirm who you are. Reopen it from the game.");
    conversation.textContent = "This help window couldn't confirm who you are. Reopen it from the game.";
    return;
  }
  widgetHeaders = { player: params.player, sig: params.sig };
  void PLAYER_HEADERS;

  const meResponse = await request(`/api/widget/${params.game}/me`);
  if (meResponse.status === 401) {
    announce('widget', "This help window couldn't confirm who you are. Reopen it from the game.");
    conversation.textContent = "This help window couldn't confirm who you are. Reopen it from the game.";
    return;
  }
  const me = (await readJson(meResponse)) as MeBody;
  state.bucket = me.bucket;
  state.threadId = me.thread_id;
  if (me.thread_id) {
    await refreshThread();
  }
  if (state.gameName === '' && me.game && typeof me.game.name === 'string') {
    state.gameName = me.game.name;
  }
  if (state.gameName === '') {
    const gameThread = state.messages.find((message) => message.author.role === 'game_server');
    state.gameName = gameThread ? gameThread.author.name : 'the game';
  }
  heading.textContent = `Help with ${state.gameName}`;
  applyBucket();

  const pollReplies = async () => {
    if (state.threadId) {
      await refreshThread();
    }
    const meNow = (await readJson(await request(`/api/widget/${params.game}/me`))) as MeBody;
    if (meNow) {
      state.bucket = meNow.bucket;
      applyBucket();
    }
  };
  window.setInterval(() => void pollReplies(), 4000);

  fileInput.addEventListener('change', () => {
    pickedFiles.textContent = '';
    for (const file of Array.from(fileInput.files ?? [])) {
      pickedFiles.append(el('li', {}, `${file.name} ${file.size}`));
    }
  });

  sendButton.addEventListener('click', () => void send());

  async function send(): Promise<void> {
    if (state.pending) return;
    if (state.retryAt !== null && Date.now() < state.retryAt) return;
    const body = messageField.value;
    const topic = topicPicker.value;
    if (body.trim() === '') {
      announce('widget', 'Write a message before sending.');
      return;
    }
    if (state.threadId === null && topic === '') {
      announce('widget', 'Choose what this is about.');
      return;
    }
    if (state.replyKey === null) state.replyKey = newKey();
    state.pending = true;
    announce('widget', 'Sending...');
    const payload: Record<string, unknown> = { body };
    if (state.threadId === null) payload.topic = topic;
    const response = await request(`/api/widget/${params!.game}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'idempotency-key': state.replyKey },
    });
    if (response.status === 201) {
      const data = (await readJson(response)) as { message: Message; thread: { id: string; status: string } };
      state.replyKey = null;
      messageField.value = '';
      state.threadId = data.thread.id;
      announce('widget', 'Sent. Replies appear here.');
      await refreshThread();
      const files = Array.from(fileInput.files ?? []);
      for (const file of files) {
        await uploadFile(file, data.message.id);
      }
      fileInput.value = '';
      pickedFiles.textContent = '';
      const meAfter = (await readJson(await request(`/api/widget/${params!.game}/me`))) as MeBody;
      if (meAfter) {
        state.bucket = meAfter.bucket;
        applyBucket();
      }
      state.pending = false;
      return;
    }
    state.pending = false;
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '1');
      state.retryAt = Date.now() + retryAfter * 1000;
      announce('widget', `You're writing faster than the inbox can read. Try again in ${retryAfter} seconds.`);
      applyBucket();
      return;
    }
    const failure = (await readJson(response)) as { error?: { code?: string; fields?: Record<string, string> } };
    if (response.status === 422 && failure?.error?.fields?.body) {
      announce('widget', failure.error.fields.body);
      return;
    }
    if (response.status === 422 && failure?.error?.fields?.topic) {
      announce('widget', failure.error.fields.topic);
      return;
    }
    announce('widget', 'Message not sent. Try again.');
  }

  async function uploadFile(file: File, messageId: string): Promise<void> {
    announce('widget', `Uploading ${file.name}...`);
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await fetch(`/api/widget/${params!.game}/messages/${messageId}/attachments`, {
      method: 'POST',
      body: form,
      headers: { 'x-hushline-player': widgetHeaders.player, 'x-hushline-player-signature': widgetHeaders.sig },
    });
    if (response.status === 202) {
      const data = (await readJson(response)) as { attachment: Attachment };
      announce('widget', `Attached ${data.attachment.filename}.`);
      await refreshThread();
      return;
    }
    const failure = (await readJson(response)) as { error?: { fields?: Record<string, string> } };
    const sentence = failure?.error?.fields?.file;
    if (sentence && sentence.includes('5,000,000')) {
      announce('widget', 'Files can be up to 5,000,000 bytes.');
      return;
    }
    if (sentence) {
      announce('widget', sentence);
      return;
    }
    announce('widget', `${file.name} didn't upload. Send it again later.`);
  }

  async function refreshThread(): Promise<void> {
    if (state.threadId === null) return;
    const response = await request(`/api/widget/${params!.game}/threads/${state.threadId}`);
    if (response.status !== 200) return;
    const thread = (await readJson(response)) as ThreadBody;
    state.messages = thread.messages;
    renderConversation(conversation, thread, heading, topicPicker);
  }

  function applyBucket(): void {
    const limited = state.bucket.retry_after_seconds !== null && state.bucket.retry_after_seconds !== undefined;
    if (limited) {
      sendButton.setAttribute('aria-disabled', 'true');
      announce('widget', `You're writing faster than the inbox can read. Try again in ${state.bucket.retry_after_seconds} seconds.`);
    } else {
      sendButton.removeAttribute('aria-disabled');
    }
  }
}

function renderConversation(container: HTMLElement, thread: ThreadBody, heading: HTMLElement, topicPicker: HTMLElement): void {
  container.textContent = '';
  for (const message of thread.messages) {
    const item = el('li', { 'data-message': message.id });
    const meta = el('p', { class: 'message-meta' }, `${message.author.name}, ${formatTime(message.created_at)}`);
    item.append(meta);
    if (message.kind === 'player' || message.kind === 'reply') {
      item.append(el('p', { class: 'message-text' }, renderFormatted(message.body ?? '')));
    } else if (message.event) {
      const event = message.event;
      if (event.type === 'purchase.receipt') {
        item.append(el('p', { class: 'message-text' }, `Purchase recorded: ${event.item}, ${formatAmount(Number(event.amount_minor), event.currency ?? '')}`));
      } else if (event.type === 'purchase.refunded') {
        if (event.refund_applied === false) {
          item.append(el('p', { class: 'message-text' }, `Refund not applied: ${event.receipt_id}, currency differs`));
        } else {
          item.append(el('p', { class: 'message-text' }, `Refund recorded: ${event.refund_id}, ${formatAmount(Number(event.amount_minor), event.currency ?? '')}`));
        }
      } else if (event.type === 'match.finished') {
        const minutes = Math.floor(Number(event.duration_seconds) / 60);
        item.append(el('p', { class: 'message-text' }, `Match ${event.result}: ${event.mode}, ${minutes} min`));
      }
    }
    for (const attachment of message.attachments) {
      item.append(el('p', { class: 'attachment-line' }, `${attachment.filename} ${attachment.status}`));
    }
    if (message.unfurl) {
      const host = new URL(message.unfurl.url).host;
      item.append(el('p', { class: 'preview' }, `${message.unfurl.title}${message.unfurl.description ? `. ${message.unfurl.description}.` : ''} ${host}`));
    }
    container.append(item);
  }
  heading.textContent = `Help with ${state.gameName}`;
  if (state.threadId !== null) {
    topicPicker.setAttribute('hidden', 'hidden');
  }
  void state;
}

