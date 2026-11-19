/** The holder's hold page: the quoted price, the countdown, release and sharing. */

import { del, get, post, serverNow } from '../api';
import { Header } from '../chrome';
import { announce, closeLayer, el, noticesNode, openLayer } from '../dom';
import { money, salesTime } from '../display';
import { currentAccount, loadSession, openSignInDialog } from '../session';
import { formatCountdown } from '../../shared/salesOfficeTime';
import type { Hold } from '../../shared/types';
import type { Page } from '../router';

const RE_READ_MS = 5000;
const LAPSE_CHECK_MS = 2000;

const ENDED_COPY: Record<string, string> = {
  buyer: 'You released this hold.',
  withdrawal: 'This home was withdrawn, so your hold ended.',
  conversion: 'This hold became a reservation.',
  lapse: 'Your hold has lapsed. This home is open to every buyer again.',
};

export function createHoldPage(url: URL): Page {
  const holdId = url.pathname.split('/')[2] ?? '';
  const header = new Header();
  const field = el('section', { class: 'hold-field' });
  const node = el('div', { class: 'page page-hold' }, [header.node, field, noticesNode()]);

  let hold: Hold | null = null;
  let countdownTimer = 0;
  let lapseTimer = 0;
  let shareBox: HTMLInputElement | null = null;
  let releaseDialog: HTMLElement | null = null;
  const shareWrapper = el('div', { class: 'share-controls' });

  const paintLoading = (): void => {
    field.replaceChildren(el('div', { class: 'loading-block' }));
  };

  const paintMissing = (): void => {
    field.replaceChildren(el('h1', { class: 'hold-heading', text: "We couldn't find that hold." }));
  };

  const paintEnded = (current: Hold): void => {
    const heading = el('h1', { class: 'hold-heading', tabindex: '-1', text: `Your hold on ${current.unitCode}` });
    const copy = ENDED_COPY[current.endedBy ?? 'lapse'];
    field.replaceChildren(heading, el('p', { class: 'hold-ended', text: copy }));
    announce(copy);
    heading.focus();
  };

  const paintActive = (current: Hold): void => {
    const heading = el('h1', { class: 'hold-heading', tabindex: '-1', text: `Your hold on ${current.unitCode}` });
    const timer = el('p', {
      class: 'hold-timer tabular',
      role: 'timer',
      'aria-label': 'Time left on this hold',
      text: formatCountdown(new Date(current.endsAt).getTime() - serverNow()),
    });
    const release = el('button', {
      type: 'button',
      class: 'action action-dark',
      text: 'Release hold',
      onclick: () => askRelease(release),
    }) as HTMLButtonElement;
    field.replaceChildren(
      heading,
      el('p', { class: 'hold-price tabular', text: `Quoted price $${money(current.quotedPrice)}` }),
      el('p', { class: 'hold-version tabular', text: `Price version ${current.priceVersion}` }),
      el('p', { class: 'hold-until tabular', text: `Held until ${salesTime(current.endsAt)}.` }),
      timer,
      release,
      shareWrapper,
    );
    paintShare(current.shareUrl);
    window.clearInterval(countdownTimer);
    countdownTimer = window.setInterval(() => {
      if (!hold) return;
      const remaining = new Date(hold.endsAt).getTime() - serverNow();
      if (remaining > 0) {
        timer.textContent = formatCountdown(remaining);
        return;
      }
      timer.textContent = 'Checking...';
      window.clearInterval(countdownTimer);
      lapseTimer = window.setInterval(() => void load(false), LAPSE_CHECK_MS);
    }, 1000);
  };

  /** Only the share controls are repainted, so nothing else moves under the buyer. */
  function paintShare(shareUrl: string | null): void {
    const wrapper = shareWrapper;
    wrapper.replaceChildren();
      if (shareUrl === null) {
        wrapper.append(
          el('button', {
            type: 'button',
            class: 'action action-dark',
            text: 'Create share link',
            onclick: (event) => void createLink(event.currentTarget as HTMLButtonElement),
          }),
        );
        shareBox = null;
        return;
      }
      const full = new URL(shareUrl, window.location.origin).toString();
      const box = el('input', {
        class: 'input share-box',
        'aria-label': 'Share link',
        readonly: true,
        value: full,
      }) as HTMLInputElement;
      shareBox = box;
      wrapper.append(
        box,
        el('button', {
          type: 'button',
          class: 'action action-dark',
          text: 'Copy link',
          onclick: () => void copyLink(full),
        }),
        el('button', {
          type: 'button',
          class: 'action action-dark',
          text: 'Make a new link',
          onclick: (event) => void createLink(event.currentTarget as HTMLButtonElement),
        }),
        el('button', {
          type: 'button',
          class: 'action action-dark',
          text: 'Revoke link',
          onclick: (event) => void revokeLink(event.currentTarget as HTMLButtonElement),
        }),
      );
  }

  async function createLink(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const result = await post<{ shareUrl: string }>(`/api/holds/${holdId}/share`, { body: {} });
    button.disabled = false;
    if (result.ok && result.data) {
      if (hold) hold = { ...hold, shareUrl: result.data.shareUrl };
      paintShare(result.data.shareUrl);
      announce('Share link ready.');
      return;
    }
    if (result.error) showError(result.error.message);
  }

  async function copyLink(full: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      shareBox?.select();
    }
    announce('Link copied.');
  }

  async function revokeLink(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const result = await del(`/api/holds/${holdId}/share`);
    button.disabled = false;
    if (result.ok || result.status === 204) {
      if (hold) hold = { ...hold, shareUrl: null };
      paintShare(null);
      announce('Share link revoked.');
      return;
    }
    if (result.error) showError(result.error.message);
  }

  function showError(message: string): void {
    const note = el('p', { class: 'hold-error', text: message });
    field.append(note);
  }

  function askRelease(opener: HTMLButtonElement): void {
    const release = el('button', { type: 'button', class: 'action action-dark', text: 'Release' }) as HTMLButtonElement;
    const keep = el('button', {
      type: 'button',
      class: 'action action-quiet',
      text: 'Keep hold',
      onclick: () => closeRelease(),
    });
    const panel = el('div', {
      class: 'dialog release-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-label': 'Release this hold?',
    }, [el('h2', { text: 'Release this hold?' }), release, keep]);
    const layer = el('div', { class: 'dialog-layer' }, [panel]);
    releaseDialog = layer;
    document.getElementById('app')?.append(layer);
    release.addEventListener('click', () => {
      release.disabled = true;
      release.textContent = 'Releasing...';
      void post<{ hold: Hold }>(`/api/holds/${holdId}/release`, { body: {} }).then((result) => {
        closeRelease();
        if (result.ok && result.data) {
          hold = result.data.hold;
          announce('Hold released.');
          paintEnded(result.data.hold);
          return;
        }
        if (result.error) showError(result.error.message);
        void load(false);
      });
    });
    openLayer({ node: layer, returnFocus: opener, onEscape: () => closeRelease() });
  }

  function closeRelease(): void {
    if (!releaseDialog) return;
    const node = releaseDialog;
    releaseDialog = null;
    closeLayer(node);
  }

  async function load(initial: boolean): Promise<void> {
    const result = await get<{ hold: Hold }>(`/api/holds/${holdId}`);
    if (result.status === 401) {
      // Escape leaves the page with only the header's Sign in.
      field.replaceChildren();
      openSignInDialog({ onSignedIn: () => void load(true) });
      return;
    }
    if (result.status === 404) {
      paintMissing();
      return;
    }
    if (!result.ok || !result.data) return;
    const next = result.data.hold;
    const wasActive = hold?.status === 'active';
    hold = next;
    header.setMyHold(next.status === 'active' ? next : null);
    if (next.status !== 'active') {
      window.clearInterval(countdownTimer);
      window.clearInterval(lapseTimer);
      closeRelease();
      if (wasActive || initial) paintEnded(next);
      return;
    }
    if (initial || !wasActive) paintActive(next);
  }

  paintLoading();
  void (async () => {
    await loadSession();
    if (!currentAccount()) {
      field.replaceChildren();
      openSignInDialog({ onSignedIn: () => void load(true) });
      return;
    }
    await load(true);
  })();

  const interval = window.setInterval(() => void load(false), RE_READ_MS);
  const onFocus = (): void => void load(false);
  window.addEventListener('focus', onFocus);

  return {
    node,
    destroy: () => {
      window.clearInterval(interval);
      window.clearInterval(countdownTimer);
      window.clearInterval(lapseTimer);
      window.removeEventListener('focus', onFocus);
    },
  };
}
