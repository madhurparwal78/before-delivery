import { request } from '../api';
import { COPY } from '../copy';
import { clear, el } from '../dom';
import { every } from '../timers';
import { overdueNotice, visitTable, type VisitLike } from '../visitlog';
import type { InspectJson } from '../../shared/types';

export function renderInspect(container: HTMLElement, token: string): void {
  const notice = overdueNotice();
  const log = visitTable('Commissary visits');
  const heading = el('h1');
  const commissary = el('p', { class: 'inspect-commissary' });
  const operator = el('p', { class: 'inspect-operator' });
  const download = el('a', {
    class: 'download-pdf',
    href: `/api/inspect/${token}/log.pdf`,
    text: 'Download PDF',
  });
  const pdfStatus = el('p', { class: 'pdf-status' });
  const headingBlock = el('section', { class: 'inspect-heading' }, [heading, commissary, operator]);
  const aside = el('section', { class: 'inspect-aside' }, [notice.element, download, pdfStatus]);

  function dead(text: string): void {
    clear(container);
    container.append(el('h1', { text }));
  }

  function load(): void {
    void request<InspectJson>(`/api/inspect/${token}`, { skipAuthGate: true }).then((result) => {
      if (!result.ok) {
        if (result.error.code === 'link_expired') dead('This link has expired');
        else if (result.error.code === 'link_revoked') dead('This link was revoked');
        else if (result.status === 404) dead('Link not found');
        return;
      }
      const data = result.data;
      heading.textContent = `${data.truck.name} commissary visits`;
      commissary.textContent = `Commissary: ${data.commissary.site_name}, ${data.commissary.address}`;
      operator.textContent = `Operator: ${data.operator.business_name}`;
      log.draw(data.visits as VisitLike[], data.commissary.time_zone);
      notice.update(data.overdue, data.last_departed_at, data.commissary.time_zone);
      if (!container.contains(headingBlock)) {
        clear(container);
        container.append(headingBlock, aside, log.root);
      }
    });
  }

  download.addEventListener('click', (event) => {
    event.preventDefault();
    void fetch(`/api/inspect/${token}/log.pdf`).then(async (response) => {
      if (!response.ok) {
        pdfStatus.textContent = COPY.pdfUnavailable;
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = el('a', { href: url, download: 'commissary-visits.pdf' });
      container.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    });
  });

  load();
  every(60000, load);
}
