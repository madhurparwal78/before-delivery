import { MSG } from '../shared/messages.js';
import type { GroupView } from '../shared/types.js';
import { announce, bootstrap, make, openSocket } from './dom.js';

interface TournamentBoot {
  tournament_id: string;
  groups: GroupView[];
}

export function startTournament(): void {
  const boot = bootstrap<TournamentBoot>();

  const paint = (groups: GroupView[]): void => {
    groups.forEach((group, index) => {
      const section = document.querySelector<HTMLElement>(`.group[data-group="${index}"]`);
      const tbody = section?.querySelector('tbody');
      if (!tbody) return;
      for (const row of group.table) {
        let line = tbody.querySelector<HTMLTableRowElement>(`tr[data-team="${row.team.id}"]`);
        if (!line) {
          line = make('tr', { 'data-team': row.team.id }) as HTMLTableRowElement;
          for (let cell = 0; cell < 7; cell += 1) line.append(make('td'));
        }
        const cells = [...line.children] as HTMLElement[];
        const values = [
          row.team.name,
          String(row.p),
          String(row.w),
          String(row.l),
          String(row.t),
          String(row.pts),
          row.nrr,
        ];
        values.forEach((value, position) => {
          if (cells[position].textContent !== value) cells[position].textContent = value;
        });
        tbody.append(line);
      }
      const matches = section?.querySelector('.group-matches');
      if (matches) {
        matches.textContent = '';
        for (const match of group.matches) {
          const item = make('li');
          const link = make('a', { href: `/matches/${match.id}/scorecard` }, `${match.home} v ${match.away}`);
          item.append(link, document.createTextNode(' '));
          item.append(make('span', { class: 'facts' }, match.result ?? match.status));
          matches.append(item);
        }
      }
    });
  };

  const connect = (): void => {
    const socket = openSocket(
      (message) => {
        const payload = message as { type: string; groups?: GroupView[] };
        if (payload.type === 'table' && payload.groups) {
          paint(payload.groups);
          announce(MSG.pointsTableUpdated);
        }
      },
      (open) => {
        open.send(JSON.stringify({ type: 'watch', tournament: boot.tournament_id }));
      },
    );
    socket.addEventListener('close', () => {
      setTimeout(connect, 1000);
    });
  };

  connect();
}
