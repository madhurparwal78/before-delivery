import { ApiFailure, api } from '../api';
import { Screen } from '../app';
import { el } from '../dom';
import { hero } from '../layout';
import { deadLinkCard } from './entry';
import { formatDisplayDate, instantWallClock } from '../../../lib/format';

interface SharePage {
  householdName: string;
  year: number;
  yearDigest: string;
  handovers: { date: string; exchangeAt: string; zone: string; from: string | null; to: string | null }[];
}

export function shareScreen(params: Record<string, string>): Screen {
  return {
    async mount(main: HTMLElement): Promise<void> {
      const token = params.token as string;

      function requestedYear(): number | null {
        const raw = new URL(window.location.href).searchParams.get('year');
        if (raw === null || !/^\d{4}$/.test(raw)) return null;
        const year = Number.parseInt(raw, 10);
        if (year < 2000 || year > 2100) return null;
        return year;
      }

      async function view(): Promise<void> {
        const year = requestedYear();
        const query = year === null ? '' : `?year=${year}`;
        let page: SharePage;
        try {
          page = (await api<SharePage>('GET', `/api/share/${token}${query}`)).data;
        } catch (error) {
          if (error instanceof ApiFailure && error.status === 404) {
            main.replaceChildren(deadLinkCard());
            return;
          }
          throw error;
        }
        if (year === null) {
          window.history.replaceState({}, '', `/share/${token}?year=${page.year}`);
        }
        const list = el('ul', { role: 'list', 'aria-label': 'Handovers', class: 'handover-list' });
        for (const handover of page.handovers) {
          const { time } = instantWallClock(handover.exchangeAt);
          list.append(
            el('li', {
              role: 'listitem',
              text: `${formatDisplayDate(handover.date)} ${time} (${handover.zone}): ${handover.from ?? 'no plan'} to ${
                handover.to ?? 'no plan'
              }`,
            }),
          );
        }
        const links = el('div', { class: 'row-actions' });
        if (page.year > 2000) {
          const previous = el('a', {
            href: `/share/${token}?year=${page.year - 1}`,
            class: 'plain-link',
            text: 'Previous year',
          });
          previous.addEventListener('click', (event) => {
            event.preventDefault();
            window.history.pushState({}, '', `/share/${token}?year=${page.year - 1}`);
            void view();
          });
          links.append(previous);
        }
        if (page.year < 2100) {
          const next = el('a', {
            href: `/share/${token}?year=${page.year + 1}`,
            class: 'plain-link',
            text: 'Next year',
          });
          next.addEventListener('click', (event) => {
            event.preventDefault();
            window.history.pushState({}, '', `/share/${token}?year=${page.year + 1}`);
            void view();
          });
          links.append(next);
        }
        main.replaceChildren(
          hero([
            el('div', { class: 'card share-card' }, [
              el('h1', { class: 'page-headline', text: `${page.householdName}: handovers in ${page.year}` }),
              el('p', { class: 'digest-line', text: `Year digest ${page.yearDigest}` }),
              links,
              list,
            ]),
          ]),
        );
      }

      await view();
      const onPopState = (): void => {
        void view();
      };
      window.addEventListener('popstate', onPopState);
      this.dispose = (): void => {
        window.removeEventListener('popstate', onPopState);
      };
    },
  };
}
