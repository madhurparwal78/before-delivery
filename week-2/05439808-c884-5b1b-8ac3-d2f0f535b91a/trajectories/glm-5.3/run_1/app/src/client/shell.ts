// The signed-in shell: the top rule with its readouts, the Main navigation, the Queues rail and
// the single open context panel. Village, Scout, Raid and Replay screens all share it.
import { el, commaFormat, formatClock, countdownText, icon } from './ui.ts';
import { navigate } from './main.ts';
import { signOut, state } from './state.ts';
import type { Village } from './api.ts';
import { serverNow } from './state.ts';

export interface Shell {
  islandHolder: HTMLElement;
  panelHost: HTMLElement;
  setUnreadClan(count: number): void;
  updateTopRule(village: Village): void;
  updateQueues(village: Village): void;
  openPanel(name: string): void;
}

let panelOpener: ((name: string) => void) | null = null;

export function setPanelOpener(opener: ((name: string) => void) | null): void {
  panelOpener = opener;
}

function changedReadout(node: HTMLElement, value: string): void {
  if (node.textContent !== value) {
    node.textContent = value;
    node.classList.add('changed');
    window.setTimeout(() => node.classList.remove('changed'), 600);
  }
}

export async function renderShell(root: HTMLElement): Promise<Shell> {
  root.replaceChildren();

  const islandHolder = el('div', { id: 'island-holder' });
  const overlay = el('div', { class: 'island-overlay' });

  // --- top rule ---

  const brine = el('span', { class: 'readout', text: 'Brine 0 / 0' });
  const peat = el('span', { class: 'readout', text: 'Peat 0 / 0' });
  const copper = el('span', { class: 'readout', text: 'Copper 0 / 0' });
  const builders = el('span', { class: 'readout', text: 'Builders 0/0' });
  const saltmark = el('span', { class: 'readout', text: 'Saltmark 0' });
  const army = el('span', { class: 'readout', text: 'Army 0/0' });
  const trophies = el('span', { class: 'readout', text: 'Trophies 0' });
  const league = el('span', { class: 'readout', text: 'League Mudflat' });
  const shield = el('span', { class: 'readout', text: '' });
  shield.hidden = true;

  const clanLink = el('a', { href: '/?panel=clan', 'aria-label': 'Clan' }, icon('clan'), el('span', { class: 'label', text: 'Clan' }));
  const clanBadge = el('span', { class: 'badge', hidden: 'true', text: '' });

  const nav = el('nav', { 'aria-label': 'Main' });
  const operator = state.me?.role === 'operator';
  if (operator) {
    nav.append(
      el('a', { href: '/', onclick: go('/'), 'aria-label': 'Village' }, icon('village'), el('span', { class: 'label', text: 'Village' })),
      el('a', { href: '/ops', onclick: go('/ops'), 'aria-label': 'Operations' }, icon('ops'), el('span', { class: 'label', text: 'Operations' })),
      el('a', { href: '/?panel=league', onclick: go('/?panel=league'), 'aria-label': 'League' }, icon('league'), el('span', { class: 'label', text: 'League' })),
      el('a', { href: '/?panel=profile', onclick: go('/?panel=profile'), 'aria-label': 'Profile' }, icon('profile'), el('span', { class: 'label', text: 'Profile' })),
    );
  } else {
    nav.append(
      el('a', { href: '/', onclick: go('/'), 'aria-label': 'Village' }, icon('village'), el('span', { class: 'label', text: 'Village' })),
      el('a', { href: '/scout', onclick: go('/scout'), 'aria-label': 'Raid' }, icon('raid'), el('span', { class: 'label', text: 'Raid' })),
      el('a', { href: '/?panel=raidlog', onclick: go('/?panel=raidlog'), 'aria-label': 'Raid log' }, icon('log'), el('span', { class: 'label', text: 'Raid log' })),
      clanLink,
      el('a', { href: '/?panel=league', onclick: go('/?panel=league'), 'aria-label': 'League' }, icon('league'), el('span', { class: 'label', text: 'League' })),
      el('a', { href: '/?panel=rewards', onclick: go('/?panel=rewards'), 'aria-label': 'Rewards' }, icon('rewards'), el('span', { class: 'label', text: 'Rewards' })),
      el('a', { href: '/?panel=profile', onclick: go('/?panel=profile'), 'aria-label': 'Profile' }, icon('profile'), el('span', { class: 'label', text: 'Profile' })),
    );
  }
  clanLink.append(clanBadge);
  const signOutButton = el('button', { 'aria-label': 'Sign out', onclick: () => void signOut() }, icon('signout'), el('span', { class: 'label', text: 'Sign out' }));
  nav.append(signOutButton);

  const topRule = el('header', { class: 'toprule' },
    el('div', { role: 'group', 'aria-label': 'Resources' }, brine, peat, copper),
    builders, saltmark, army, trophies, league, shield,
    el('span', { class: 'spacer' }),
    nav
  );

  // --- queues rail ---

  const builderList = el('ul', { class: 'queue-list', 'aria-label': 'Builder queue' });
  const armyList = el('ul', { class: 'queue-list', 'aria-label': 'Army queue' });
  const hideButton = el('button', { text: 'Hide queues', class: 'toggle', 'aria-label': 'Queues' });
  const queues = el('aside', { class: 'queues-rail', role: 'region', 'aria-label': 'Queues', 'aria-expanded': 'true' },
    hideButton,
    el('h2', { text: 'Builder queue' }),
    builderList,
    el('h2', { text: 'Army queue' }),
    armyList
  );
  hideButton.addEventListener('click', () => {
    const collapsed = !queues.classList.contains('collapsed');
    queues.classList.toggle('collapsed', collapsed);
    hideButton.textContent = collapsed ? 'Show queues' : 'Hide queues';
    queues.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  const shellElement = el('div', { class: 'app-shell' }, islandHolder, overlay, topRule, queues);
  root.append(shellElement);

  // unread clan messages while the chat log is hidden
  let lastSeenMessageId = 0;
  if (state.me?.clanId !== null && state.me?.role !== 'operator') {
    const { setPollJob } = await import('./state.ts');
    const { api } = await import('./api.ts');
    setPollJob('clan-unread', async () => {
      if (state.clanChatVisible || state.me?.clanId === null) return;
      try {
        const result = await api<{ messages: { id: number }[] }>('GET', '/api/clan/messages?after=0');
        const latest = result.messages.length > 0 ? result.messages[result.messages.length - 1].id : 0;
        if (lastSeenMessageId === 0) {
          lastSeenMessageId = latest;
          return;
        }
        if (latest > lastSeenMessageId) {
          state.unreadClan += latest - countNewMessages(result.messages, lastSeenMessageId);
          lastSeenMessageId = latest;
          shell2.setUnreadClan(state.unreadClan);
        }
      } catch {
        // retried next tick
      }
    });
  }

  const panelHost = el('aside', { class: 'context-panel hidden', role: 'complementary', 'aria-label': 'Panel' });
  root.append(panelHost);

  const shell2 = { setUnreadClan: (count: number): void => undefined } as Shell;
  const shell: Shell = {
    islandHolder,
    panelHost,
    setUnreadClan(count: number): void {
      shell2.setUnreadClan = (n: number): void => {
        if (n > 0 && !state.clanChatVisible) {
          clanLink.setAttribute('aria-label', `Clan (${n} unread)`);
          clanBadge.hidden = false;
          clanBadge.textContent = String(n);
        } else {
          clanLink.setAttribute('aria-label', 'Clan');
          clanBadge.hidden = true;
        }
      };
      if (count > 0 && !state.clanChatVisible) {
        clanLink.setAttribute('aria-label', `Clan (${count} unread)`);
        clanBadge.hidden = false;
        clanBadge.textContent = String(count);
      } else {
        clanLink.setAttribute('aria-label', 'Clan');
        clanBadge.hidden = true;
        clanBadge.textContent = '';
      }
    },
    updateTopRule(village: Village): void {
      changedReadout(brine, `Brine ${commaFormat(village.resources.brine.amount)} / ${commaFormat(village.resources.brine.cap)}`);
      changedReadout(peat, `Peat ${commaFormat(village.resources.peat.amount)} / ${commaFormat(village.resources.peat.cap)}`);
      changedReadout(copper, `Copper ${commaFormat(village.resources.copper.amount)} / ${commaFormat(village.resources.copper.cap)}`);
      changedReadout(builders, `Builders ${village.builders.free}/${village.builders.total}`);
      changedReadout(saltmark, `Saltmark ${village.saltmark}`);
      changedReadout(army, `Army ${commaFormat(village.army.housing.used)}/${commaFormat(village.army.housing.capacity)}`);
      changedReadout(trophies, `Trophies ${commaFormat(village.trophies)}`);
      changedReadout(league, `League ${village.league}`);
      if (village.shield !== null && state.me !== null) {
        shield.hidden = false;
        changedReadout(shield, `Shielded until ${formatClock(Date.parse(village.shield.endsAt), state.me.timeZone)}`);
      } else {
        shield.hidden = true;
      }
    },
    updateQueues(village: Village): void {
      const zone = state.me?.timeZone ?? 'UTC';
      const now = serverNow();
      builderList.replaceChildren(
        ...village.buildings
          .filter((b) => b.upgrade !== null)
          .map((b) => el('li', {},
            el('span', { text: `${buildingLabel(b.type)} → level ${b.upgrade!.toLevel} · ${countdownText(Date.parse(b.upgrade!.finishesAt) - now)}` })
          ))
      );
      armyList.replaceChildren(
        ...village.army.training.map((batch) => {
          const waiting = Date.parse(batch.startsAt) > now;
          const text = waiting
            ? `${batch.count} × ${unitLabel(batch.unit)} · starts ${formatClock(Date.parse(batch.startsAt), zone)}`
            : `${batch.count} × ${unitLabel(batch.unit)} · ${countdownText(Date.parse(batch.finishesAt) - now)}`;
          const cancel = el('button', { 'aria-label': `Cancel training of ${batch.count} ${unitLabel(batch.unit)}`, text: '✕', onclick: () => void cancelBatch(batch.id, batch.count, batch.unit) });
          return el('li', {}, el('span', { text }), cancel);
        })
      );
    },
    openPanel(name: string): void {
      panelOpener?.(name);
    },
  };

  function go(path: string): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      event.preventDefault();
      if (path.startsWith('/?panel=') && location.pathname === '/') {
        shell.openPanel(path.slice('/?panel='.length));
        return;
      }
      void navigate(path);
    };
  }

  async function cancelBatch(batchId: number, count: number, unit: 'saltjack' | 'peat_slinger'): Promise<void> {
    const { api, ApiRequestError } = await import('./api.ts');
    const { alertMessage, notice } = await import('./ui.ts');
    try {
      const result = await api<{ refunded: { brine: number; peat: number; copper: number } }>('POST', `/api/army/training/${batchId}/cancel`, {});
      notice(`Training of ${count} ${unitLabel(unit)} cancelled. Refunded ${amountsText(result.refunded)}.`);
    } catch (err) {
      if (err instanceof ApiRequestError) alertMessage(err.api.message);
      else alertMessage('Lost contact with the server. Check your connection and try again.');
    }
  }

  return shell;
}

function amountsText(amounts: { brine: number; peat: number; copper: number }): string {
  const parts: string[] = [];
  if (amounts.brine !== 0) parts.push(`${commaFormat(amounts.brine)} brine`);
  if (amounts.peat !== 0) parts.push(`${commaFormat(amounts.peat)} peat`);
  if (amounts.copper !== 0) parts.push(`${commaFormat(amounts.copper)} copper`);
  return parts.length === 0 ? 'nothing' : parts.join(', ');
}

export function buildingLabel(type: string): string {
  return LABELS[type] ?? type;
}

export function unitLabel(unit: string): string {
  return unit === 'saltjack' ? 'Saltjack' : 'Peat Slinger';
}

const LABELS: Record<string, string> = {
  brine_pan: 'Brine Pan',
  peat_cutter: 'Peat Cutter',
  copper_sluice: 'Copper Sluice',
  brine_cistern: 'Brine Cistern',
  peat_rick: 'Peat Rick',
  copper_vault: 'Copper Vault',
  tide_barracks: 'Tide Barracks',
  driftwood_camp: 'Driftwood Camp',
  kiln_tower: 'Kiln Tower',
};


function countNewMessages(messages: { id: number }[], lastSeen: number): number {
  return messages.filter((m) => m.id > lastSeen).length;
}
