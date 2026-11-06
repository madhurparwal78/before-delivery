import { request } from '../../api.js';
import { el } from '../../dom.js';
import { number } from '../../format.js';
import type { ClanStanding } from '../../apitypes.js';

export function leaguePanel(): { node: HTMLElement; update: () => void } {
  const body = el('tbody');
  const table = el('table', { role: 'table', 'aria-label': 'Clan standings', class: 'table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Rank' }),
        el('th', { scope: 'col', text: 'Clan' }),
        el('th', { scope: 'col', text: 'Trophies' }),
        el('th', { scope: 'col', text: 'Members' })
      ])
    ]),
    body
  ]);
  const node = el('aside', { role: 'complementary', 'aria-label': 'League', class: 'panel' }, [
    el('h2', { text: 'League' }),
    table
  ]);

  const load = async (): Promise<void> => {
    const result = await request<{ clans: ClanStanding[] }>('GET', '/api/league/clans');
    body.replaceChildren(
      ...result.clans.map((clan) =>
        el('tr', {}, [
          el('td', { text: String(clan.rank) }),
          el('td', { text: clan.name }),
          el('td', { text: number(clan.trophies) }),
          el('td', { text: String(clan.memberCount) })
        ])
      )
    );
  };

  void load();
  return { node, update: () => void load() };
}
