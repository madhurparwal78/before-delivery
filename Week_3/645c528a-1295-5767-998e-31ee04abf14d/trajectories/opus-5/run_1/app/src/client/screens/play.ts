import { NO_GUIDELINES_MIN_LEVEL, TIERS } from '../../shared/catalog.js';
import { PLAY_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { clear, el, labelledButton, statusRegion } from '../dom.js';
import { navigate, type Screen, type ScreenContext } from '../navigate.js';
import { onServerEvent, refreshMe, state } from '../state.js';

type Mode = 'eight-ball' | 'nine-ball' | 'no-guidelines';

export function modePickerScreen(): Screen {
  const notice = statusRegion('Play notice', 'notice');
  const level = state.me?.level ?? 1;
  const nineBall = labelledButton('9-Ball', () => navigate('/play?mode=nine-ball'), { className: 'mode-card' });
  const noGuidelines = labelledButton(
    'No Guidelines',
    () => {
      if (level < NO_GUIDELINES_MIN_LEVEL) {
        notice.textContent = PLAY_COPY.modeLocked;
        return;
      }
      navigate('/play?mode=no-guidelines');
    },
    {
      className: 'mode-card',
      children: [
        el('span', { text: 'No Guidelines' }),
        el('span', { className: 'card-lock', text: level < NO_GUIDELINES_MIN_LEVEL ? PLAY_COPY.modeLocked : '' }),
      ],
    },
  );
  const element = el('div', {
    className: 'mode-picker',
    children: [
      el('h1', { className: 'screen-heading', text: 'Play Special', attrs: { tabindex: '-1' } }),
      el('div', { className: 'mode-grid', children: [nineBall, noGuidelines] }),
      notice,
    ],
  });
  return { element };
}

export function tierPickerScreen(context: ScreenContext): Screen {
  const mode = (context.url.searchParams.get('mode') ?? 'eight-ball') as Mode;
  let selected = 0;
  let queued = false;
  let ticketPolling: number | null = null;

  const track = el('div', { className: 'tier-track' });
  const region = el('div', {
    className: 'tier-region',
    attrs: { role: 'region', 'aria-label': 'Stake tiers', tabindex: '0' },
    children: [track],
  });
  const selectedStatus = statusRegion('Selected tier', 'notice');
  const queueStatus = statusRegion('Queue', 'notice');
  const cancelButton = labelledButton('Cancel', () => void leaveQueue(), { className: 'button' });
  cancelButton.hidden = true;

  const cards = TIERS.map((tier) => {
    const lock = el('p', { className: 'tier-lock' });
    const links = el('div', { className: 'tier-links' });
    const joinHost = el('div', { className: 'tier-join' });
    const card = el('div', {
      className: 'tier-card',
      attrs: { role: 'group', 'aria-label': tier.name },
      children: [
        el('h2', { text: tier.name }),
        el('p', { className: 'tier-entry', text: `Entry ${num(tier.entry)}` }),
        el('p', { className: 'tier-pot', text: `Pot ${num(tier.pot)}` }),
        lock,
        links,
        joinHost,
      ],
    });
    track.append(card);
    return { tier, card, lock, links, joinHost };
  });

  function affordable(index: number): boolean {
    const tier = TIERS[index];
    const me = state.me;
    if (!tier || !me) return false;
    return me.level >= tier.minLevel && me.coins >= tier.entry;
  }

  function levelReached(index: number): boolean {
    const tier = TIERS[index];
    const me = state.me;
    if (!tier || !me) return false;
    return me.level >= tier.minLevel;
  }

  function highestAvailableBelow(index: number): number | null {
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if (affordable(candidate)) return candidate;
    }
    return null;
  }

  function render(): void {
    const me = state.me;
    const tier = TIERS[selected];
    selectedStatus.textContent = tier ? tier.name : '';
    track.style.setProperty('--index', String(selected));
    cards.forEach((entry, index) => {
      entry.card.classList.toggle('selected', index === selected);
      clear(entry.links);
      clear(entry.joinHost);
      const reached = levelReached(index);
      if (!reached) {
        entry.lock.textContent = PLAY_COPY.lockedTier(entry.tier.minLevel);
        return;
      }
      const shortfall = entry.tier.entry - (me?.coins ?? 0);
      if (shortfall > 0) {
        entry.lock.textContent = PLAY_COPY.unaffordable(shortfall);
        if ((me?.coins ?? 0) < 100 && (me?.refillsLeft ?? 0) > 0) {
          const refill = el('a', { className: 'link', text: 'Refill', attrs: { href: '/home', 'aria-label': 'Refill' } });
          refill.addEventListener('click', (event) => {
            event.preventDefault();
            navigate('/home');
          });
          entry.links.append(refill);
        } else if (index > 0 && highestAvailableBelow(index) !== null) {
          const lower = el('a', { className: 'link', text: 'Lower tier', attrs: { href: '#', 'aria-label': 'Lower tier' } });
          lower.addEventListener('click', (event) => {
            event.preventDefault();
            const target = highestAvailableBelow(index);
            if (target !== null) {
              selected = target;
              render();
            }
          });
          entry.links.append(lower);
        }
        return;
      }
      entry.lock.textContent = '';
      if (index === selected && !queued) {
        entry.joinHost.append(labelledButton('Join table', () => void joinQueue(), { className: 'button primary' }));
      }
    });
  }

  function move(step: number): void {
    if (queued) return;
    const next = selected + step;
    if (next < 0 || next >= TIERS.length) return;
    selected = next;
    render();
    const joinButton = cards[selected]?.joinHost.querySelector('button');
    if (!joinButton) region.focus();
  }

  async function joinQueue(): Promise<void> {
    const tier = TIERS[selected];
    if (!tier) return;
    const result = await api<{ ticketId: string }>('POST', '/api/queue', { mode, tier: tier.tier });
    if (!result.ok) {
      queueStatus.textContent = result.failure.message;
      return;
    }
    queued = true;
    cancelButton.hidden = false;
    queueStatus.textContent = PLAY_COPY.searching(3);
    render();
    cancelButton.focus();
    poll();
  }

  function poll(): void {
    if (ticketPolling !== null) window.clearInterval(ticketPolling);
    ticketPolling = window.setInterval(() => void checkQueue(), 1000);
  }

  async function checkQueue(): Promise<void> {
    const result = await api<{ status: string; band?: number; tableUrl?: string; message?: string }>('GET', '/api/queue');
    if (!result.ok) return;
    const body = result.data;
    if (body.status === 'paired' && body.tableUrl) {
      stopPolling();
      await refreshMe();
      navigate(body.tableUrl);
      return;
    }
    if (body.status === 'queued') {
      queueStatus.textContent = PLAY_COPY.searching(body.band ?? 3);
      return;
    }
    if (body.status === 'none' && queued) {
      queued = false;
      cancelButton.hidden = true;
      queueStatus.textContent = body.message ?? PLAY_COPY.leftQueue;
      render();
      stopPolling();
    }
  }

  function stopPolling(): void {
    if (ticketPolling !== null) window.clearInterval(ticketPolling);
    ticketPolling = null;
  }

  async function leaveQueue(): Promise<void> {
    const result = await api<{ status: string }>('DELETE', '/api/queue');
    if (!result.ok) {
      queueStatus.textContent = result.failure.message;
      return;
    }
    queued = false;
    cancelButton.hidden = true;
    queueStatus.textContent = PLAY_COPY.leftQueue;
    stopPolling();
    render();
    region.focus();
  }

  region.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!queued && affordable(selected)) void joinQueue();
    }
  });

  let touchStart: number | null = null;
  region.addEventListener('touchstart', (event) => {
    touchStart = (event as TouchEvent).touches[0]?.clientX ?? null;
  });
  region.addEventListener('touchend', (event) => {
    if (touchStart === null) return;
    const end = (event as TouchEvent).changedTouches[0]?.clientX ?? touchStart;
    const delta = end - touchStart;
    const cardWidth = cards[0]?.card.getBoundingClientRect().width ?? 240;
    if (Math.abs(delta) > cardWidth / 4) move(delta < 0 ? 1 : -1);
    touchStart = null;
  });

  const keyHandler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && queued) {
      event.preventDefault();
      void leaveQueue();
    }
  };
  document.addEventListener('keydown', keyHandler);

  const unsubscribe = onServerEvent('queue', (data) => {
    const payload = data as { status?: string; tableUrl?: string } | null;
    if (payload?.status === 'paired' && payload.tableUrl) {
      stopPolling();
      void refreshMe().then(() => navigate(payload.tableUrl as string));
    }
  });

  const element = el('div', {
    className: 'tier-picker',
    children: [
      el('h1', { className: 'screen-heading', text: 'Stake tables', attrs: { tabindex: '-1' } }),
      selectedStatus,
      region,
      el('div', { className: 'queue-row', children: [queueStatus, cancelButton] }),
    ],
  });

  render();
  window.setTimeout(() => region.focus(), 0);

  return {
    element,
    update: render,
    destroy: () => {
      stopPolling();
      document.removeEventListener('keydown', keyHandler);
      unsubscribe();
    },
  };
}
