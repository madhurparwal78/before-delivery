import { api } from '../api';
import { el, find, must, pulse } from '../dom';
import { hhmm } from '../format';
import { MAIL_BANNER_COPY, onSocket, setRegion, status } from '../live';
import type { Notice, StatusBody } from '../../shared/types';

export async function startNoticesPage(initial: { status: StatusBody }): Promise<void> {
  const list = must<HTMLElement>('[data-notice-list]');
  let notices: Notice[] = [];

  function noticeRow(notice: Notice): HTMLElement {
    const tail =
      notice.state === 'sent' && notice.sent_at !== null
        ? `Sent ${hhmm(notice.sent_at)}`
        : 'Queued';
    return el('li', { class: 'notice-row', 'data-notice-row': notice.id }, [
      `${notice.subject} · to ${notice.to} · ${tail}`,
    ]);
  }

  function paint(): void {
    list.replaceChildren(...notices.map((notice) => noticeRow(notice)));
  }

  function paintMail(next: StatusBody): void {
    setRegion('mail', next.services.mail === 'down' ? MAIL_BANNER_COPY : '');
  }

  notices = (await api.get<{ notices: Notice[] }>('/api/notices')).notices;
  paint();
  paintMail(status() ?? initial.status);

  onSocket((message) => {
    if (message.type === 'status') paintMail(message);
    if (message.type !== 'notice') return;
    const index = notices.findIndex((candidate) => candidate.id === message.notice.id);
    if (index === -1) {
      notices = [message.notice, ...notices];
      paint();
      const row = find<HTMLElement>(`[data-notice-row="${message.notice.id}"]`);
      if (row) pulse(row);
      return;
    }
    notices[index] = message.notice;
    const row = find<HTMLElement>(`[data-notice-row="${message.notice.id}"]`);
    const replacement = noticeRow(message.notice);
    if (row) {
      row.replaceWith(replacement);
      pulse(replacement);
    }
  });
}
