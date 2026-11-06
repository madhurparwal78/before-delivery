import { button, el } from '../../dom.js';
import { amounts, localDateTime } from '../../format.js';
import { navigate } from '../../router.js';
import { state } from '../../store.js';
import type { RaidListRow } from '../../apitypes.js';

export function raidLogPanel(): { node: HTMLElement; update: () => void } {
  let tab: 'attack' | 'defence' = 'attack';
  const list = el('div', { class: 'raid-rows' });

  const attacksTab = el('button', {
    type: 'button',
    role: 'tab',
    'aria-label': 'Attacks',
    'aria-selected': 'true',
    class: 'tab'
  });
  attacksTab.textContent = 'Attacks';
  const defencesTab = el('button', {
    type: 'button',
    role: 'tab',
    'aria-label': 'Defences',
    'aria-selected': 'false',
    class: 'tab'
  });
  defencesTab.textContent = 'Defences';

  const node = el('aside', { role: 'complementary', 'aria-label': 'Raid log', class: 'panel' }, [
    el('h2', { text: 'Raid log' }),
    el('div', { role: 'tablist', 'aria-label': 'Raid roles', class: 'tabs' }, [
      attacksTab,
      defencesTab
    ]),
    list
  ]);

  const rowLabel = (raid: RaidListRow): string => {
    const when = localDateTime(raid.resolvedAt ?? raid.lockedAt);
    if (raid.state === 'resolved') {
      return `${raid.stars ?? 0} stars · ${raid.destruction ?? 0}% · ${amounts(
        raid.transferred
      )} · ${when}`;
    }
    if (raid.state === 'abandoned') return `Abandoned · ${when}`;
    return `Under way · ${when}`;
  };

  const update = (): void => {
    attacksTab.setAttribute('aria-selected', tab === 'attack' ? 'true' : 'false');
    defencesTab.setAttribute('aria-selected', tab === 'defence' ? 'true' : 'false');
    const raids = tab === 'attack' ? state.attacks : state.defences;
    list.replaceChildren(
      ...raids.map((raid) => {
        const row = el('div', { class: 'raid-row' }, [el('span', { text: rowLabel(raid) })]);
        if (raid.state === 'resolved') {
          const label =
            raid.role === 'attack'
              ? `Replay raid on ${raid.opponent.displayName}`
              : `Replay raid by ${raid.opponent.displayName}`;
          const open = button(label);
          open.addEventListener('click', () => navigate(`/raids/${raid.id}/replay`));
          row.append(open);
        }
        return row;
      })
    );
  };

  attacksTab.addEventListener('click', () => {
    tab = 'attack';
    update();
  });
  defencesTab.addEventListener('click', () => {
    tab = 'defence';
    update();
  });

  update();
  return { node, update };
}
