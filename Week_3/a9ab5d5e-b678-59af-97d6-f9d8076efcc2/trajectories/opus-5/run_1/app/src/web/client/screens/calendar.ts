import { Me, api, cachedIdentity, householdPath } from '../api';
import { Screen, navigate, onLiveEntry, setWaitingCount, takeKeptDialog } from '../app';
import { el } from '../dom';
import { YearDoc, createStage, dayAnswerText } from '../stage';
import { openSwapDialog } from '../swapDialog';
import { formatDisplayDate, formatInstantDisplay } from '../../../lib/format';
import { daysInMonth, isoWeekday, toDateString } from '../../../domain/time';

interface Tonight {
  date: string;
  owner: 'planning' | 'other' | null;
  ruleName: string | null;
  nextHandover: { at: string; zone: string; from: string | null; to: string | null } | null;
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function calendarScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let tonightTimer = 0;
  let stageHandle: ReturnType<typeof createStage> | null = null;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = cachedIdentity() as Me;
      const url = new URL(window.location.href);
      const yearParam = url.searchParams.get('year');
      let year = yearParam && /^\d{4}$/.test(yearParam) ? Number.parseInt(yearParam, 10) : Number.parseInt(me.household.today.slice(0, 4), 10);
      let doc: YearDoc | null = null;
      let digest = '';
      let focusedMonth = Number.parseInt(me.household.today.slice(5, 7), 10);

      const digestLine = el('p', { class: 'digest-line' });
      const gridHolder = el('div', { class: 'grid-holder' });
      const previousMonth = el('button', { type: 'button', class: 'plain-button', text: 'Previous month' });
      const nextMonth = el('button', { type: 'button', class: 'plain-button', text: 'Next month' });
      const calendarRegion = el('section', { role: 'region', 'aria-label': 'Calendar', class: 'card calendar-card' }, [
        el('div', { class: 'month-controls' }, [previousMonth, nextMonth]),
        gridHolder,
        digestLine,
      ]);
      const tonightRegion = el('section', { role: 'region', 'aria-label': 'Tonight', class: 'card tonight-card' });
      const summaryRegion = el('section', { role: 'region', 'aria-label': 'Requests summary', class: 'card summary-card' });
      const stageHolder = el('div', { class: 'stage-holder' });
      const noPlan = el('p', { class: 'empty-line' });
      main.append(stageHolder, el('div', { class: 'calendar-body' }, [calendarRegion, tonightRegion, summaryRegion]));

      async function loadYear(nextYear: number): Promise<void> {
        year = nextYear;
        const result = await api<YearDoc>('GET', householdPath(`/years/${year}`));
        doc = result.data;
        digest = (result.etag ?? '').replace(/"/g, '');
        digestLine.textContent = `Year digest ${digest}`;
        if (doc.days.every((day) => day.owner === null)) {
          noPlan.textContent = 'No plan yet.';
          if (!noPlan.isConnected) calendarRegion.append(noPlan);
        } else {
          noPlan.remove();
        }
        if (!stageHandle) {
          stageHandle = createStage({
            me,
            doc,
            onRequestSwap: (first, opener) => openSwapDialog({ me, opener, firstNight: first }),
          });
          stageHolder.append(stageHandle.element);
        } else {
          stageHandle.update(doc);
        }
        paintGrid();
      }

      function dayOf(date: string): YearDoc['days'][number] | null {
        if (!doc) return null;
        return doc.days.find((day) => day.date === date) ?? null;
      }

      function cellName(date: string): string {
        const day = dayOf(date);
        const name =
          day && day.owner
            ? day.owner === 'planning'
              ? me.household.planningName
              : me.household.otherName
            : 'no plan';
        return `${formatDisplayDate(date)}, ${name}`;
      }

      let focusedDate = me.household.today;

      function paintGrid(): void {
        const grid = el('div', {
          role: 'grid',
          'aria-label': `${monthNames[focusedMonth - 1] as string} ${year}`,
          class: 'month-grid',
        });
        const header = el('div', { role: 'row', class: 'grid-row grid-head' });
        for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
          header.append(el('span', { role: 'columnheader', text: label, class: 'grid-head-cell' }));
        }
        grid.append(header);
        const total = daysInMonth(year, focusedMonth);
        const firstWeekday = isoWeekday(toDateString(year, focusedMonth, 1));
        let row = el('div', { role: 'row', class: 'grid-row' });
        for (let blank = 1; blank < firstWeekday; blank += 1) {
          row.append(el('span', { role: 'gridcell', class: 'grid-cell is-blank', 'aria-hidden': 'true' }));
        }
        if (focusedDate.slice(0, 7) !== `${year}-${String(focusedMonth).padStart(2, '0')}`) {
          focusedDate = toDateString(year, focusedMonth, 1);
        }
        for (let dayNumber = 1; dayNumber <= total; dayNumber += 1) {
          const date = toDateString(year, focusedMonth, dayNumber);
          const day = dayOf(date);
          const cell = el('span', {
            role: 'gridcell',
            class: `grid-cell owner-${day?.owner ?? 'none'}`,
            'aria-label': cellName(date),
            'data-date': date,
            tabindex: date === focusedDate ? '0' : '-1',
          }, [
            el('span', { class: 'cell-day', text: String(dayNumber) }),
            el('span', {
              class: 'cell-who',
              text: day && day.owner ? (day.owner === 'planning' ? me.household.planningName : me.household.otherName) : 'no plan',
            }),
          ]);
          row.append(cell);
          if (row.childElementCount === 7) {
            grid.append(row);
            row = el('div', { role: 'row', class: 'grid-row' });
          }
        }
        if (row.childElementCount > 0) {
          while (row.childElementCount < 7) {
            row.append(el('span', { role: 'gridcell', class: 'grid-cell is-blank', 'aria-hidden': 'true' }));
          }
          grid.append(row);
        }
        gridHolder.replaceChildren(grid);
      }

      function writeDayAnswer(date: string): void {
        const day = dayOf(date);
        const answer = main.ownerDocument.querySelector('[aria-label="Day answer"]');
        if (!answer) return;
        answer.textContent = day ? dayAnswerText(day, me) : `${formatDisplayDate(date)}: no plan`;
      }

      async function moveFocus(date: string): Promise<void> {
        const nextYear = Number.parseInt(date.slice(0, 4), 10);
        const nextMonthNumber = Number.parseInt(date.slice(5, 7), 10);
        focusedDate = date;
        if (nextYear !== year) {
          focusedMonth = nextMonthNumber;
          await loadYear(nextYear);
        } else if (nextMonthNumber !== focusedMonth) {
          focusedMonth = nextMonthNumber;
          paintGrid();
        }
        const cell = gridHolder.querySelector<HTMLElement>(`[data-date="${date}"]`);
        if (cell) {
          for (const other of gridHolder.querySelectorAll<HTMLElement>('[data-date]')) {
            other.tabIndex = other === cell ? 0 : -1;
          }
          cell.focus();
        }
        writeDayAnswer(date);
      }

      function shiftDate(date: string, days: number): string {
        const time = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
        return new Date(time).toISOString().slice(0, 10);
      }

      function shiftMonth(date: string, months: number): string {
        const year0 = Number.parseInt(date.slice(0, 4), 10);
        const month0 = Number.parseInt(date.slice(5, 7), 10);
        const day0 = Number.parseInt(date.slice(8, 10), 10);
        const total = (year0 * 12 + (month0 - 1)) + months;
        const targetYear = Math.floor(total / 12);
        const targetMonth = (total % 12) + 1;
        return toDateString(targetYear, targetMonth, Math.min(day0, daysInMonth(targetYear, targetMonth)));
      }

      gridHolder.addEventListener('keydown', (event) => {
        const target = event.target as HTMLElement;
        const date = target.dataset.date;
        if (!date) return;
        const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };
        if (event.key in keys) {
          event.preventDefault();
          void moveFocus(shiftDate(date, keys[event.key] as number));
          return;
        }
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          const weekday = isoWeekday(date);
          const shift = event.key === 'Home' ? 1 - weekday : 7 - weekday;
          void moveFocus(shiftDate(date, shift));
          return;
        }
        if (event.key === 'PageUp' || event.key === 'PageDown') {
          event.preventDefault();
          void moveFocus(shiftMonth(date, event.key === 'PageUp' ? -1 : 1));
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          openSwapDialog({ me, opener: target, firstNight: date });
        }
      });

      gridHolder.addEventListener('click', (event) => {
        const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-date]');
        if (cell?.dataset.date) void moveFocus(cell.dataset.date);
      });

      previousMonth.addEventListener('click', () => {
        void moveFocus(shiftMonth(toDateString(year, focusedMonth, 1), -1));
      });
      nextMonth.addEventListener('click', () => {
        void moveFocus(shiftMonth(toDateString(year, focusedMonth, 1), 1));
      });

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 's' && event.key !== 'S') return;
        const target = event.target as HTMLElement;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        if (!target.closest('.stage') && !target.closest('.calendar-card') && target !== document.body) return;
        event.preventDefault();
        const inGridDate = target.dataset?.date ?? null;
        openSwapDialog({ me, opener: target, firstNight: inGridDate });
      };
      document.addEventListener('keydown', onKeyDown);

      async function paintTonight(): Promise<void> {
        const result = await api<Tonight>('GET', householdPath('/tonight'));
        const tonight = result.data;
        const name =
          tonight.owner === 'planning'
            ? me.household.planningName
            : tonight.owner === 'other'
              ? me.household.otherName
              : 'no plan';
        const handoverLine = tonight.nextHandover
          ? `Next handover: ${formatInstantDisplay(tonight.nextHandover.at, tonight.nextHandover.zone)}, ${
              tonight.nextHandover.from === 'planning' ? me.household.planningName : me.household.otherName
            } to ${tonight.nextHandover.to === 'planning' ? me.household.planningName : me.household.otherName}`
          : 'No handover in the next 60 days.';
        tonightRegion.replaceChildren(
          el('p', { class: 'tonight-line', text: `Tonight: ${name}` }),
          el('p', { class: 'handover-line', text: handoverLine }),
        );
      }

      async function paintSummary(): Promise<void> {
        const sent = await api<{ items: { state: string; createdBy: string }[] }>(
          'GET',
          householdPath('/swaps?state=sent&limit=100'),
        );
        const sentCosts = await api<{ items: { state: string; paidBy: string }[] }>(
          'GET',
          householdPath('/costs?state=sent&limit=100'),
        );
        const waiting =
          sent.data.items.filter((item) => item.createdBy !== me.role).length +
          sentCosts.data.items.filter((item) => item.paidBy !== me.role).length;
        const mine =
          sent.data.items.filter((item) => item.createdBy === me.role).length +
          sentCosts.data.items.filter((item) => item.paidBy === me.role).length;
        const link = el('a', { href: '/requests', class: 'plain-link', text: 'Open requests' });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          navigate('/requests');
        });
        summaryRegion.replaceChildren(
          el('p', { text: `Waiting for you: ${waiting}` }),
          el('p', { text: `Sent by you: ${mine}` }),
          link,
        );
        setWaitingCount(waiting);
      }

      await loadYear(year);
      await paintTonight();
      await paintSummary();
      const kept = takeKeptDialog();
      if (kept && kept.kind === 'swap') openSwapDialog({ me, opener: null, values: kept.values });

      tonightTimer = window.setInterval(() => {
        void paintTonight();
      }, 60000);
      stopLive = onLiveEntry(() => {
        void loadYear(year);
        void paintTonight();
        void paintSummary();
      });

      this.dispose = (): void => {
        document.removeEventListener('keydown', onKeyDown);
        window.clearInterval(tonightTimer);
        stopLive?.();
        stageHandle?.dispose();
        stageHandle = null;
      };
    },
  };
}
