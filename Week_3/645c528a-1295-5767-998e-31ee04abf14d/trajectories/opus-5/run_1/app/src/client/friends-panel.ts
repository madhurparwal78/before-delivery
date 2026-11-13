import { FRIENDS_COPY } from '../shared/copy.js';
import { api } from './api.js';
import { clear, el, labelledButton, statusRegion } from './dom.js';
import { navigate } from './navigate.js';
import { onServerEvent } from './state.js';

interface FriendsBody {
  friendCode: string;
  friends: { id: string; displayName: string; presence: 'online' | 'in_match' | 'offline' }[];
  incoming: { requestId: string; id: string; displayName: string }[];
  outgoing: { requestId: string; id: string; displayName: string }[];
  blocked: { id: string; displayName: string }[];
}

const MOTION_MS = 330;

export class FriendsPanel {
  readonly element: HTMLElement;
  private readonly notice = statusRegion('Friends notice', 'notice');
  private readonly codeText = el('p', { className: 'friend-code' });
  private readonly list = el('ul', { className: 'friends-list', attrs: { role: 'list', 'aria-label': 'Friends list' } });
  private readonly requests = el('div', { className: 'friend-requests' });
  private readonly codeInput: HTMLInputElement;
  private hideTimer: number | null = null;
  private opener: HTMLElement | null = null;
  private readonly unsubscribe: () => void;
  private openState = false;

  constructor(private readonly onToggle: (open: boolean) => void) {
    this.codeInput = el('input', { className: 'text-input', attrs: { type: 'text', 'aria-label': 'Friend code' } });
    const closeButton = labelledButton('Close friends', () => this.close(), { className: 'button quiet' });
    const sendButton = labelledButton('Send request', () => void this.sendRequest(), { className: 'button' });
    const privateButton = labelledButton('Create private table', () => void this.createPrivateTable(), { className: 'button' });

    this.element = el('aside', {
      className: 'friends-panel',
      attrs: { role: 'region', 'aria-label': 'Friends' },
      children: [
        el('h2', { text: 'Friends' }),
        closeButton,
        this.codeText,
        el('div', { className: 'field-row', children: [el('label', { text: 'Friend code' }), this.codeInput, sendButton] }),
        privateButton,
        this.notice,
        this.requests,
        this.list,
      ],
    });
    this.element.hidden = true;
    this.element.setAttribute('inert', '');
    this.element.setAttribute('aria-hidden', 'true');
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    this.unsubscribe = onServerEvent('friends', () => void this.load());
  }

  destroy(): void {
    this.unsubscribe();
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(opener: HTMLElement | null): void {
    this.opener = opener;
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.openState = true;
    this.element.hidden = false;
    this.element.removeAttribute('inert');
    this.element.removeAttribute('aria-hidden');
    requestAnimationFrame(() => this.element.classList.add('open'));
    this.onToggle(true);
    void this.load();
    this.element.querySelector<HTMLElement>('button')?.focus();
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.element.classList.remove('open');
    this.element.setAttribute('inert', '');
    this.element.setAttribute('aria-hidden', 'true');
    const delay = document.documentElement.classList.contains('reduced-motion') ? 0 : MOTION_MS;
    this.hideTimer = window.setTimeout(() => {
      if (!this.openState) this.element.hidden = true;
      this.hideTimer = null;
    }, delay);
    this.onToggle(false);
    if (this.opener && document.contains(this.opener)) this.opener.focus();
  }

  async load(): Promise<void> {
    const result = await api<FriendsBody>('GET', '/api/friends');
    if (!result.ok) return;
    const body = result.data;
    this.codeText.textContent = `Your friend code ${body.friendCode}`;
    clear(this.list);
    for (const friend of body.friends) {
      this.list.append(
        el('li', {
          className: 'friend-row',
          attrs: { role: 'listitem' },
          children: [
            el('span', { text: `${friend.displayName} ${FRIENDS_COPY.presence[friend.presence]}` }),
            labelledButton(`Block ${friend.displayName}`, () => void this.block(friend.id), { className: 'button quiet' }),
          ],
        }),
      );
    }
    clear(this.requests);
    for (const request of body.incoming) {
      this.requests.append(
        el('div', {
          className: 'friend-row',
          children: [
            el('span', { text: request.displayName }),
            labelledButton(`Accept ${request.displayName}`, () => void this.accept(request.requestId, request.displayName), {
              className: 'button',
            }),
            labelledButton(`Decline ${request.displayName}`, () => void this.decline(request.requestId), { className: 'button quiet' }),
          ],
        }),
      );
    }
  }

  private async sendRequest(): Promise<void> {
    const code = this.codeInput.value.trim();
    const result = await api<{ requestId: string; displayName: string }>('POST', '/api/friends/requests', { code });
    if (result.ok) {
      this.notice.textContent = FRIENDS_COPY.requestSent(result.data.displayName);
      this.codeInput.value = '';
      await this.load();
      return;
    }
    this.notice.textContent = result.failure.message;
  }

  private async accept(requestId: string, name: string): Promise<void> {
    const result = await api('POST', `/api/friends/requests/${requestId}/accept`);
    this.notice.textContent = result.ok ? FRIENDS_COPY.accepted(name) : result.failure.message;
    await this.load();
  }

  private async decline(requestId: string): Promise<void> {
    await api('POST', `/api/friends/requests/${requestId}/decline`);
    await this.load();
  }

  private async block(playerId: string): Promise<void> {
    await api('POST', `/api/friends/${playerId}/block`);
    await this.load();
  }

  private async createPrivateTable(): Promise<void> {
    const result = await api<{ tableId: string; tableUrl: string; inviteUrl: string }>('POST', '/api/private-tables');
    if (result.ok) {
      sessionStorage.setItem(`hs:invite:${result.data.tableId}`, result.data.inviteUrl);
      navigate(result.data.tableUrl);
      return;
    }
    this.notice.textContent = result.failure.message;
  }
}
