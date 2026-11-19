import { request } from '../api';
import { el } from '../dom';
import { every } from '../timers';
import { overdueNotice, visitTable, type VisitLike } from '../visitlog';
import type { AppContext } from '../main';

interface VisitsResponse {
  truck: { id: string; name: string; permit_number: string };
  visits: VisitLike[];
  last_departed_at: string | null;
  overdue: boolean;
}

export function renderTruck(container: HTMLElement, ctx: AppContext): void {
  const member = ctx.me.member;
  if (member === null || member.truck === null) return;
  const truck = member.truck;
  const zone = ctx.siteById(member.home_site_id)?.time_zone ?? 'UTC';
  const notice = overdueNotice();
  const log = visitTable('Visit log');
  container.append(
    el('h1', { text: `${truck.name} commissary visits` }),
    el('p', { text: `Permit ${truck.permit_number}` }),
    notice.element,
    log.root,
  );

  const load = (): void => {
    void request<VisitsResponse>(`/api/trucks/${truck.id}/visits`).then((result) => {
      if (!result.ok) return;
      log.draw(result.data.visits, zone);
      notice.update(result.data.overdue, result.data.last_departed_at, zone);
    });
  };
  load();
  every(60000, load);
}
