import { SHOP_ITEMS } from '../../shared/catalog.js';
import { HOME_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { openSignUpSheet } from '../auth-sheet.js';
import { clear, el, labelledButton, statusRegion } from '../dom.js';
import { FriendsPanel } from '../friends-panel.js';
import { navigate, type Screen } from '../navigate.js';
import { readCachedChips, refreshMe, state } from '../state.js';

interface ModeCard {
  name: string;
  action: () => void;
  needsAccount: boolean;
  online: boolean;
}

export function homeScreen(): Screen {
  const notice = statusRegion('Home notice', 'notice');
  const connection = statusRegion('Connection', 'notice connection');
  const mailNotice = statusRegion('Mail notice', 'notice');
  const coinsChip = el('span', { className: 'chip', attrs: { role: 'status', 'aria-label': 'Coins', 'aria-live': 'polite' } });
  const cashChip = el('span', { className: 'chip', attrs: { role: 'status', 'aria-label': 'Cash', 'aria-live': 'polite' } });
  const equippedCue = el('p', { className: 'equipped-cue', attrs: { role: 'status', 'aria-label': 'Equipped cue' } });
  const xpBar = el('div', {
    className: 'xp-bar',
    attrs: { role: 'progressbar', 'aria-label': 'XP', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
  });
  const levelText = el('p', { className: 'level-text' });
  const identityName = el('p', { className: 'profile-name' });
  const identityLink = el('a', {
    className: 'profile-link',
    attrs: { href: '/profile', 'aria-label': 'Profile' },
    children: [el('span', { className: 'avatar', attrs: { 'aria-hidden': 'true' } })],
  });
  identityLink.addEventListener('click', (event) => {
    event.preventDefault();
    navigate('/profile');
  });
  const chipRow = el('div', { className: 'chip-row' });
  const modes = el('div', { className: 'modes', attrs: { role: 'region', 'aria-label': 'Modes', tabindex: '-1' }, id: 'modes' });
  const mainCards = el('div', { className: 'mode-grid' });
  const secondaryRow = el('div', { className: 'secondary-row' });
  modes.append(mainCards, secondaryRow);

  const friendsButton = labelledButton(
    'Friends',
    () => {
      if (!state.me) {
        openSignUpSheet({ opener: friendsButton, onSuccess: () => panel.open(friendsButton) });
        return;
      }
      if (panel.isOpen) panel.close();
      else panel.open(friendsButton);
    },
    { className: 'button', attrs: { 'aria-expanded': 'false' } },
  );
  const panel = new FriendsPanel((open) => friendsButton.setAttribute('aria-expanded', open ? 'true' : 'false'));

  const skipLink = el('a', { className: 'skip-link', text: 'Skip to modes', attrs: { href: '#modes', 'aria-label': 'Skip to modes' } });
  skipLink.addEventListener('click', (event) => {
    event.preventDefault();
    modes.focus();
  });

  const backToTable = el('a', { className: 'button', text: 'Back to table', attrs: { href: '/home', 'aria-label': 'Back to table' } });
  backToTable.hidden = true;
  backToTable.addEventListener('click', (event) => {
    event.preventDefault();
    if (state.me?.activeTableUrl) navigate(state.me.activeTableUrl);
  });

  const dailyButton = labelledButton('Claim daily reward', () => void claimDaily(), { className: 'button' });
  const refillButton = labelledButton('Refill', () => void claimRefill(), { className: 'button' });
  const refillsLeftText = el('span', { className: 'refills-left' });
  const retryButton = labelledButton('Retry', () => void refreshMe(), { className: 'button quiet' });

  async function claimDaily(): Promise<void> {
    dailyButton.disabled = true;
    const result = await api<{ coins: number }>('POST', '/api/wallet/daily-reward');
    notice.textContent = result.ok ? HOME_COPY.dailyClaimed : result.failure.message;
    await refreshMe();
  }

  async function claimRefill(): Promise<void> {
    refillButton.disabled = true;
    const result = await api<{ coins: number }>('POST', '/api/wallet/refill');
    notice.textContent = result.ok ? HOME_COPY.refillAdded : result.failure.message;
    refillButton.disabled = false;
    await refreshMe();
  }

  const cards: ModeCard[] = [
    { name: 'Play 1-on-1', action: () => navigate('/play'), needsAccount: true, online: true },
    { name: 'Play Special', action: () => navigate('/play/special'), needsAccount: true, online: true },
    { name: 'Play with Friends', action: () => panel.open(friendsButton), needsAccount: true, online: true },
    { name: 'Practice Offline', action: () => navigate('/practice'), needsAccount: false, online: false },
    { name: 'Shop', action: () => navigate('/shop'), needsAccount: true, online: true },
    { name: 'Settings', action: () => navigate('/settings'), needsAccount: false, online: false },
    { name: 'Tournaments', action: () => navigate('/tournaments'), needsAccount: true, online: true },
    { name: 'Clubs', action: () => navigate('/clubs'), needsAccount: true, online: true },
    { name: 'Leaderboards', action: () => navigate('/leaderboards'), needsAccount: true, online: true },
  ];

  const cardButtons = cards.map((card) => {
    const highlight = el('span', { className: 'card-highlight' });
    const offline = el('span', { className: 'card-offline' });
    const button = labelledButton(
      card.name,
      () => {
        if (card.needsAccount && !state.me) {
          openSignUpSheet({ opener: button, onSuccess: card.action });
          return;
        }
        card.action();
      },
      { className: 'mode-card', children: [el('span', { className: 'card-name', text: card.name })] },
    );
    const wrapper = el('div', { className: 'card-wrap', children: [button, highlight, offline] });
    return { card, button, highlight, offline, wrapper };
  });

  for (const entry of cardButtons.slice(0, 6)) mainCards.append(entry.wrapper);
  for (const entry of cardButtons.slice(6)) secondaryRow.append(entry.wrapper);

  const element = el('div', {
    className: 'home',
    children: [
      skipLink,
      el('h1', { className: 'screen-heading', text: 'Headstring', attrs: { tabindex: '-1' } }),
      el('div', { className: 'identity', children: [identityLink, identityName, levelText, xpBar, equippedCue] }),
      chipRow,
      el('div', { className: 'notices', children: [notice, connection, mailNotice, backToTable] }),
      modes,
      el('div', { className: 'home-tools', children: [friendsButton] }),
      panel.element,
    ],
  });

  function update(): void {
    const me = state.me;
    const cached = state.cachedChips ?? readCachedChips();
    identityName.textContent = me ? me.displayName : 'Guest';
    levelText.textContent = me ? `Level ${num(me.level)}` : '';
    levelText.hidden = !me;
    if (me) {
      const share = me.xpToNext > 0 ? Math.round((me.xp / me.xpToNext) * 100) : 0;
      xpBar.setAttribute('aria-valuenow', String(share));
      xpBar.textContent = `${num(me.xp)} / ${num(me.xpToNext)} XP`;
      const cue = SHOP_ITEMS.find((item) => item.id === me.equippedCueId);
      equippedCue.textContent = cue ? cue.name : '';
    }
    xpBar.hidden = !me;
    equippedCue.hidden = !me;

    clear(chipRow);
    if (me || state.storeDown) {
      const coins = me ? me.coins : cached?.coins ?? null;
      const cash = me ? me.cash : cached?.cash ?? null;
      coinsChip.textContent = state.storeDown ? `${coins === null ? '' : num(coins)} ${HOME_COPY.stale}`.trim() : num(coins ?? 0);
      cashChip.textContent = state.storeDown ? `${cash === null ? '' : num(cash)} ${HOME_COPY.stale}`.trim() : num(cash ?? 0);
      chipRow.append(coinsChip, cashChip);
      if (me) {
        dailyButton.disabled = me.dailyRewardClaimed;
        chipRow.append(dailyButton);
        if (me.coins < 100) {
          refillsLeftText.textContent = `${num(me.refillsLeft)} left today`;
          chipRow.append(refillButton, refillsLeftText);
        }
      }
    }

    connection.textContent = state.storeDown ? HOME_COPY.storeDown : '';
    if (state.storeDown) connection.append(retryButton);
    else retryButton.remove();
    mailNotice.textContent = me?.mailDelayed ? HOME_COPY.mailDelayed : '';
    backToTable.hidden = !me?.activeTableUrl;

    const offline = !state.online;
    for (const entry of cardButtons) {
      const blocked = offline && entry.card.online;
      entry.button.disabled = blocked;
      entry.offline.textContent = blocked ? HOME_COPY.offline : '';
      const firstMatch = entry.card.name === 'Play 1-on-1' && me !== null && me.wins + me.losses === 0;
      entry.highlight.textContent = firstMatch ? HOME_COPY.firstMatch : '';
    }
  }

  update();

  return {
    element,
    topics: [],
    update,
    destroy: () => panel.destroy(),
  };
}
