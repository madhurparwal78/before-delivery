import { request } from '../api.js';
import { noticeCopy, pendingCopy } from '../copy.js';
import { button, el, setText } from '../dom.js';
import { amounts, countdown, localTime, number } from '../format.js';
import { navigate, markSignedOut } from '../router.js';
import { serverNow, state } from '../store.js';
import { BUILDINGS, UNITS } from '../../shared/catalog.js';
import { run } from './action.js';
import { icon } from './icons.js';

type NavLink = { label: string; path: string; icon: string };

const NAV_LINKS: NavLink[] = [
  { label: 'Village', path: '/', icon: 'village' },
  { label: 'Raid', path: '/scout', icon: 'raid' },
  { label: 'Raid log', path: '/raid-log', icon: 'log' },
  { label: 'Clan', path: '/clan', icon: 'clan' },
  { label: 'League', path: '/league', icon: 'league' },
  { label: 'Rewards', path: '/rewards', icon: 'rewards' },
  { label: 'Profile', path: '/profile', icon: 'profile' }
];

const OPERATOR_LINKS: NavLink[] = [
  { label: 'Village', path: '/', icon: 'village' },
  { label: 'Operations', path: '/ops', icon: 'operations' },
  { label: 'League', path: '/league', icon: 'league' },
  { label: 'Profile', path: '/profile', icon: 'profile' }
];

export type Shell = {
  node: HTMLElement;
  stage: HTMLElement;
  panelHost: HTMLElement;
  update: () => void;
  setRaidClock: (remainingMs: number | null, finalizeMs: number | null) => void;
};

export function createShell(): Shell {
  const brine = el('span', { class: 'readout' });
  const peat = el('span', { class: 'readout' });
  const copper = el('span', { class: 'readout' });
  const resources = el('div', { role: 'group', 'aria-label': 'Resources', class: 'resources' }, [
    brine,
    peat,
    copper
  ]);
  const builders = el('span', { class: 'readout' });
  const saltmark = el('span', { class: 'readout' });
  const army = el('span', { class: 'readout' });
  const trophies = el('span', { class: 'readout' });
  const league = el('span', { class: 'readout' });
  const shield = el('span', { class: 'readout shield', hidden: true });
  const raidClock = el('span', {
    role: 'timer',
    'aria-label': 'Raid clock',
    class: 'readout',
    hidden: true
  });
  const finalizeText = el('span', { class: 'readout', hidden: true });

  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' });
  const signOut = button('Sign out', { class: 'nav-signout' }, [
    icon('signout'),
    el('span', { class: 'nav-label', text: 'Sign out' })
  ]);
  signOut.addEventListener('click', () => {
    void run({
      action: 'signin',
      pending: pendingCopy.signout,
      control: signOut,
      work: () => request<void>('POST', '/api/auth/signout', { body: {} }),
      success: () => null
    }).then(() => {
      markSignedOut();
      state.user = null;
      state.village = null;
      navigate('/signin');
    });
  });

  const topRule = el('header', { class: 'top-rule' }, [
    resources,
    el('div', { class: 'readouts' }, [
      builders,
      saltmark,
      army,
      trophies,
      league,
      shield,
      raidClock,
      finalizeText
    ]),
    nav
  ]);

  const builderQueue = el('ul', { role: 'list', 'aria-label': 'Builder queue', class: 'queue' });
  const armyQueue = el('ul', { role: 'list', 'aria-label': 'Army queue', class: 'queue' });
  const railToggle = button('Hide queues', { class: 'rail-toggle' });
  const rail = el('aside', { role: 'region', 'aria-label': 'Queues', class: 'queues-rail' }, [
    el('h2', { text: 'Queues', class: 'rail-title' }),
    builderQueue,
    armyQueue
  ]);
  let railOpen = window.innerWidth >= 1024;
  const applyRail = (): void => {
    rail.hidden = !railOpen;
    railToggle.textContent = railOpen ? 'Hide queues' : 'Show queues';
    railToggle.setAttribute('aria-label', railOpen ? 'Hide queues' : 'Show queues');
  };
  railToggle.addEventListener('click', () => {
    railOpen = !railOpen;
    applyRail();
  });
  applyRail();

  const stage = el('main', { class: 'stage' });
  const panelHost = el('div', { class: 'panel-host' });
  const node = el('div', { class: 'shell' }, [
    topRule,
    el('div', { class: 'shell-body' }, [
      el('div', { class: 'rail-column' }, [railToggle, rail]),
      stage,
      panelHost
    ])
  ]);

  const renderNav = (): void => {
    const links = state.user?.role === 'operator' ? OPERATOR_LINKS : NAV_LINKS;
    const children: Node[] = [];
    for (const link of links) {
      const unreadSuffix =
        link.label === 'Clan' && state.unread > 0 ? ` (${state.unread} unread)` : '';
      const anchor = el('a', {
        href: link.path,
        class: 'nav-link',
        'aria-label': `${link.label}${unreadSuffix}`
      });
      anchor.append(icon(link.icon));
      anchor.append(el('span', { class: 'nav-label', text: link.label }));
      if (unreadSuffix !== '') {
        anchor.append(el('span', { class: 'unread-badge', text: String(state.unread) }));
      }
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(link.path);
      });
      children.push(anchor);
    }
    children.push(signOut);
    nav.replaceChildren(...children);
  };

  const update = (): void => {
    renderNav();
    const village = state.village;
    if (village === null) {
      setText(brine, 'Brine 0 / 0');
      setText(peat, 'Peat 0 / 0');
      setText(copper, 'Copper 0 / 0');
      setText(builders, 'Builders 0/0');
      setText(saltmark, 'Saltmark 0');
      setText(army, 'Army 0/0');
      setText(trophies, `Trophies ${number(state.user?.trophies ?? 0)}`);
      setText(league, `League ${state.user?.league ?? 'Mudflat'}`);
      shield.hidden = true;
      builderQueue.replaceChildren();
      armyQueue.replaceChildren();
      return;
    }
    setText(
      brine,
      `Brine ${number(village.resources.brine.amount)} / ${number(village.resources.brine.cap)}`
    );
    setText(
      peat,
      `Peat ${number(village.resources.peat.amount)} / ${number(village.resources.peat.cap)}`
    );
    setText(
      copper,
      `Copper ${number(village.resources.copper.amount)} / ${number(village.resources.copper.cap)}`
    );
    setText(builders, `Builders ${village.builders.free}/${village.builders.total}`);
    setText(saltmark, `Saltmark ${number(village.saltmark)}`);
    setText(army, `Army ${village.army.housing.used}/${village.army.housing.capacity}`);
    setText(trophies, `Trophies ${number(village.trophies)}`);
    setText(league, `League ${village.league}`);
    if (village.shield === null) {
      shield.hidden = true;
      shield.textContent = '';
    } else {
      shield.hidden = false;
      setText(shield, `Shielded until ${localTime(village.shield.endsAt)}`);
    }

    builderQueue.replaceChildren(
      ...village.buildings
        .filter((building) => building.upgrade !== null)
        .map((building) => {
          const upgrade = building.upgrade;
          const remaining = upgrade === null ? 0 : new Date(upgrade.finishesAt).getTime() - serverNow();
          return el('li', {
            class: 'queue-row',
            text: `${BUILDINGS[building.type].name} → level ${upgrade?.toLevel ?? 0} · ${countdown(remaining)}`
          });
        })
    );

    armyQueue.replaceChildren(
      ...village.army.training.map((batch) => {
        const starts = new Date(batch.startsAt).getTime();
        const finishes = new Date(batch.finishesAt).getTime();
        const waiting = starts > serverNow();
        const label = waiting
          ? `${batch.count} × ${UNITS[batch.unit].name} · starts ${localTime(batch.startsAt)}`
          : `${batch.count} × ${UNITS[batch.unit].name} · ${countdown(finishes - serverNow())}`;
        const cancel = button(`Cancel training of ${batch.count} ${UNITS[batch.unit].name}`);
        cancel.addEventListener('click', () => {
          void run({
            action: 'cancelTraining',
            pending: pendingCopy.cancelTraining,
            control: cancel,
            work: () =>
              request<{ refunded: Record<string, number> }>(
                'POST',
                `/api/army/training/${batch.id}/cancel`,
                { body: {} }
              ),
            success: (result) =>
              noticeCopy.cancelTrainingSuccess(
                batch.count,
                UNITS[batch.unit].name,
                amounts(result.refunded)
              )
          });
        });
        return el('li', { class: 'queue-row' }, [el('span', { text: label }), cancel]);
      })
    );
  };

  const setRaidClock = (remainingMs: number | null, finalizeMs: number | null): void => {
    if (remainingMs === null) {
      raidClock.hidden = true;
      finalizeText.hidden = true;
      return;
    }
    raidClock.hidden = false;
    finalizeText.hidden = false;
    setText(raidClock, countdown(remainingMs));
    setText(finalizeText, `Finalize by ${countdown(finalizeMs ?? 0)}`);
  };

  return { node, stage, panelHost, update, setRaidClock };
}
