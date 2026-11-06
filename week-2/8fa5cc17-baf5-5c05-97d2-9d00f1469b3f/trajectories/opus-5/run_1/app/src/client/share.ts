import { COPY } from '../shared/copy';

type ShareStatus = { status: 'active' | 'expired' | 'revoked'; expires_at_display?: string };

type ShareCollection = {
  status: 'active';
  collection: { name: string };
  expires_at_display: string;
  objects: { id: string; title: string; type_name: string }[];
};

type ShareBlock =
  | { kind: 'text'; id: string; body: string }
  | { kind: 'quote'; id: string; body: string; origin_title: string }
  | { kind: 'quote'; hidden: true }
  | { kind: 'attachment'; id: string; attachment: { id: string; filename: string; content_type: string } };

type ShareObject = {
  id: string;
  title: string;
  type_name: string;
  properties: Record<string, unknown>;
  blocks: ShareBlock[];
  backlinks: { from_object_id: string; from_title: string; kind: string }[];
};

const REFRESH_MS = 5000;
const host = document.getElementById('quire-share-root') as HTMLElement;
const token = window.location.pathname.split('/')[2] ?? '';
const objectMatch = /\/s\/[^/]+\/o\/([^/]+)/.exec(window.location.pathname);
const objectId = objectMatch === null ? null : objectMatch[1];

function node(tag: string, text?: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className !== undefined) element.className = className;
  return element;
}

function clear(element: HTMLElement): void {
  while (element.firstChild !== null) element.removeChild(element.firstChild);
}

async function fetchJson<T>(path: string): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(path, { credentials: 'omit' });
    const text = await response.text();
    return { status: response.status, data: text === '' ? null : (JSON.parse(text) as T) };
  } catch {
    return { status: 0, data: null };
  }
}

function showInactive(statusWord: 'expired' | 'revoked' | 'unknown'): void {
  clear(host);
  if (statusWord === 'unknown') {
    host.append(node('h1', COPY.shareUnknownHeading));
    const status = node('p', '', 'link-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-label', 'Link status');
    status.textContent = COPY.shareUnknownHeading;
    host.append(status);
    return;
  }
  host.append(node('h1', COPY.shareInactiveHeading));
  const status = node('p', `${COPY.shareInactiveHeading}. ${COPY.shareInactiveBody}`, 'link-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Link status');
  host.append(status);
}

function renderCollection(payload: ShareCollection): void {
  clear(host);
  host.append(node('h1', payload.collection.name));
  const status = node('p', `Expires ${payload.expires_at_display}`, 'link-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Link status');
  host.append(status);
  const list = document.createElement('ul');
  list.className = 'shared-notes';
  list.setAttribute('aria-label', 'Shared notes');
  for (const object of payload.objects) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/s/${token}/o/${object.id}`;
    link.textContent = object.title;
    item.append(link);
    list.append(item);
  }
  host.append(list);
}

/** The reader sees only what the link covers, with the allowed marks. */
function renderObject(payload: ShareObject): void {
  clear(host);
  const page = node('div', undefined, 'share-page');
  const column = node('div', undefined, 'share-column');
  column.append(node('h1', payload.title));
  const properties = node('dl', undefined, 'share-properties');
  for (const [name, value] of Object.entries(payload.properties)) {
    if (value === null) continue;
    properties.append(node('dt', name), node('dd', String(value)));
  }
  column.append(properties);
  for (const block of payload.blocks) {
    if (block.kind === 'text') {
      const wrapper = node('div', undefined, 'share-block');
      wrapper.innerHTML = block.body;
      column.append(wrapper);
      continue;
    }
    if (block.kind === 'quote' && 'hidden' in block) {
      column.append(node('p', COPY.shareQuoteOutOfScope, 'share-quote-hidden'));
      continue;
    }
    if (block.kind === 'quote') {
      const figure = document.createElement('figure');
      figure.className = 'share-quote';
      const body = node('div');
      body.innerHTML = block.body;
      const caption = document.createElement('figcaption');
      caption.textContent = block.origin_title;
      figure.append(body, caption);
      column.append(figure);
      continue;
    }
    const figure = document.createElement('figure');
    figure.className = 'share-attachment';
    if (block.attachment.content_type.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = `/s/${token}/api/attachments/${block.attachment.id}`;
      image.alt = block.attachment.filename;
      figure.append(image);
    } else {
      const link = document.createElement('a');
      link.href = `/s/${token}/api/attachments/${block.attachment.id}`;
      link.textContent = block.attachment.filename;
      figure.append(link);
    }
    column.append(figure);
  }
  const backlinks = node('section', undefined, 'share-backlinks');
  backlinks.setAttribute('role', 'region');
  backlinks.setAttribute('aria-label', 'Backlinks');
  backlinks.append(node('h2', 'Backlinks'));
  const list = document.createElement('ul');
  for (const backlink of payload.backlinks) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/s/${token}/o/${backlink.from_object_id}`;
    link.textContent = backlink.from_title;
    item.append(link);
    list.append(item);
  }
  backlinks.append(list);
  page.append(column, backlinks);
  host.append(page);
}

function showOutOfScope(): void {
  clear(host);
  host.append(node('h1', COPY.shareOutOfScope));
  const status = node('p', '', 'link-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Link status');
  status.textContent = COPY.shareOutOfScope;
  host.append(status);
}

async function refresh(): Promise<void> {
  const status = await fetchJson<ShareStatus>(`/s/${token}/api/status`);
  if (status.status === 404) {
    showInactive('unknown');
    return;
  }
  if (status.data !== null && status.data.status !== 'active') {
    showInactive(status.data.status);
    return;
  }
  if (objectId === null) {
    const result = await fetchJson<ShareCollection>(`/s/${token}/api/collection`);
    if (result.status === 404) {
      showInactive('unknown');
      return;
    }
    if (result.status === 410) {
      const body = result.data as unknown as { status: 'expired' | 'revoked' } | null;
      showInactive(body?.status ?? 'revoked');
      return;
    }
    if (result.data !== null) renderCollection(result.data);
    return;
  }
  const result = await fetchJson<ShareObject>(`/s/${token}/api/objects/${objectId}`);
  if (result.status === 404) {
    const body = result.data as unknown as { status?: string; error?: string } | null;
    if (body?.status === 'unknown') showInactive('unknown');
    else showOutOfScope();
    return;
  }
  if (result.status === 410) {
    const body = result.data as unknown as { status: 'expired' | 'revoked' } | null;
    showInactive(body?.status ?? 'revoked');
    return;
  }
  if (result.data !== null) renderObject(result.data);
}

void refresh();
window.setInterval(() => void refresh(), REFRESH_MS);
