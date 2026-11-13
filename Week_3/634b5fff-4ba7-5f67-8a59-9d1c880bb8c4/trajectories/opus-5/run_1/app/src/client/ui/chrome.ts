import { bannerCopy, type Chapter } from '../../shared/copy.js';
import { markMotion, markTree, runMotion } from '../motion.js';
import { shelfModel, store } from '../store.js';
import { el } from './dom.js';
import { boxesHeld, formatTimeLeft, heldBox, holdStatus } from './hold.js';

export interface ChromeOptions {
  root: HTMLElement;
  discrete: boolean;
  onStrike: () => void;
  onStepChapter: (direction: 1 | -1) => void;
  onGoToCheckout: () => void;
  onPutBack: () => void;
}

export interface Chrome {
  banner: HTMLElement;
  main: HTMLElement;
  captions: HTMLElement;
  storyStatus: HTMLElement;
  matchbox: HTMLElement;
  strikeButton: HTMLButtonElement;
  setCaption(text: string): void;
  setStoryStatus(text: string): void;
  setStoryVisible(visible: boolean): void;
  setHoldBarVisible(visible: boolean): void;
  setStrikeEnabled(enabled: boolean): void;
  focusCheckout(): void;
  refreshBanner(): void;
  refreshHoldBar(): void;
  playNarration(chapter: Chapter): void;
  setSignedIn(signedIn: boolean): void;
  syncSound(): void;
}

export function mountChrome(options: ChromeOptions): Chrome {
  const banner = el('div', { class: 'banner', role: 'alert', 'aria-label': 'Sales banner' });

  const signIn = el('a', { href: '/auth/login', text: 'Staff sign-in' });
  const signOut = el('button', { type: 'button', text: 'Sign out' });
  signOut.hidden = true;
  signOut.addEventListener('click', () => {
    runMotion(signOut, 'press');
    void fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }).then(() => {
      window.location.assign('/staff');
    });
  });
  const topbar = el('div', { class: 'topbar' }, [signIn, signOut]);

  const main = el('main', {});

  const captionText = el('p', {});
  const captions = el('div', { class: 'captions', role: 'region', 'aria-label': 'Captions' }, [
    captionText,
  ]);

  const storyStatus = el('div', { class: 'story-status', role: 'status', 'aria-label': 'Story status' });

  const strikeButton = el('button', { type: 'button', text: 'Strike a match' });
  strikeButton.addEventListener('click', () => {
    runMotion(strikeButton, 'press');
    options.onStrike();
  });

  const soundButton = el('button', {
    type: 'button',
    text: 'Sound',
    'aria-pressed': store.soundChoice() === 'on' ? 'true' : 'false',
  });
  soundButton.addEventListener('click', () => {
    runMotion(soundButton, 'press');
    const next = store.soundChoice() === 'on' ? 'off' : 'on';
    store.chooseSound(next);
    soundButton.setAttribute('aria-pressed', next === 'on' ? 'true' : 'false');
    if (next === 'off') stopNarration();
  });

  const matchboxChildren: HTMLElement[] = [strikeButton, soundButton];
  if (options.discrete) {
    const previous = el('button', { type: 'button', text: 'Previous chapter' });
    previous.addEventListener('click', () => {
      runMotion(previous, 'press');
      options.onStepChapter(-1);
    });
    const next = el('button', { type: 'button', text: 'Next chapter' });
    next.addEventListener('click', () => {
      runMotion(next, 'press');
      options.onStepChapter(1);
    });
    matchboxChildren.push(previous, next);
  }
  const matchbox = el('div', { class: 'matchbox' }, matchboxChildren);

  const timer = el('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' });
  const holdStatusNode = el('span', { role: 'status', 'aria-label': 'Hold status' });
  const heldCount = el('span', { class: 'held-count', role: 'status', 'aria-label': 'Boxes held' });
  const toCheckout = el('button', { type: 'button', class: 'primary', text: 'Go to checkout' });
  toCheckout.addEventListener('click', () => {
    runMotion(toCheckout, 'press');
    options.onGoToCheckout();
  });
  const putItBack = el('button', { type: 'button', text: 'Put it back' });
  putItBack.addEventListener('click', () => {
    runMotion(putItBack, 'press');
    options.onPutBack();
  });
  const holdBar = el('div', { class: 'holdbar', role: 'region', 'aria-label': 'Hold bar' }, [
    timer,
    holdStatusNode,
    toCheckout,
    putItBack,
    heldCount,
  ]);

  options.root.append(banner, topbar, main, captions, storyStatus, matchbox, holdBar);
  markTree(options.root);
  markMotion(heldCount, 'count');
  markMotion(main, 'route');

  const narration = new Audio();
  let narrating: Chapter | null = null;
  function stopNarration(): void {
    narration.pause();
    narrating = null;
  }

  let heldShown = 0;

  /** Kept in place rather than rebuilt, so focus inside the bar survives a tick. */
  function refreshHoldBar(): void {
    const hold = heldBox();
    holdStatusNode.textContent = holdStatus();
    const count = boxesHeld();
    heldCount.textContent = String(count);
    if (count !== heldShown) {
      heldShown = count;
      runMotion(heldCount, 'count');
    }
    timer.hidden = hold === null;
    toCheckout.hidden = hold === null;
    putItBack.hidden = hold === null;
    timer.textContent = hold === null ? '' : formatTimeLeft(hold.remainingMs);
  }

  function refreshBanner(): void {
    if (shelfModel.salesPaused) {
      banner.textContent = bannerCopy.sales_paused;
      return;
    }
    if (!shelfModel.salesOpen) {
      banner.textContent = bannerCopy.edition_closed;
      return;
    }
    banner.textContent = '';
  }

  refreshHoldBar();
  refreshBanner();

  return {
    banner,
    main,
    captions,
    storyStatus,
    matchbox,
    strikeButton,
    setCaption(text) {
      captionText.textContent = text;
    },
    setStoryStatus(text) {
      storyStatus.textContent = text;
    },
    setStoryVisible(visible) {
      captions.hidden = !visible;
      matchbox.hidden = !visible;
      storyStatus.hidden = !visible;
    },
    setHoldBarVisible(visible) {
      holdBar.hidden = !visible;
    },
    setStrikeEnabled(enabled) {
      strikeButton.disabled = !enabled;
    },
    focusCheckout() {
      toCheckout.focus();
    },
    refreshBanner,
    refreshHoldBar,
    playNarration(chapter) {
      if (store.soundChoice() !== 'on') {
        stopNarration();
        return;
      }
      if (narrating === chapter) return;
      narrating = chapter;
      narration.src = `/narration/${chapter}.ogg`;
      void narration.play().catch(() => undefined);
    },
    setSignedIn(signedIn) {
      signIn.hidden = signedIn;
      signOut.hidden = !signedIn;
    },
    syncSound() {
      soundButton.setAttribute('aria-pressed', store.soundChoice() === 'on' ? 'true' : 'false');
    },
  };
}
