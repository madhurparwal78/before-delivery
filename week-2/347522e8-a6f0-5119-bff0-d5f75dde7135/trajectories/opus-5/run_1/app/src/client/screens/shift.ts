/**
 * Shift: the usage sheet for one kitchen day, with check-in, check-out and
 * blocking a station. The day lives in the address, so a reload or the Back
 * button keeps the day being looked at.
 */

import { api, ApiError, inBackground, messageFor } from '../api.js';
import { serverNow } from '../clock.js';
import * as copy from '../../shared/copy.js';
import {
  SLOT_MINUTES,
  dayOfMonth,
  isDateString,
  kitchenDate,
  kitchenHhmm,
  minutesToHhmm,
  monthName,
  weekdayName,
} from '../../shared/kitchenTime.js';
import type { StationsResponse, UsageSheetResponse, UsageSheetRow } from '../../shared/types.js';
import { clear, el, field, setFieldError } from '../dom.js';
import { navigate, replaceAddressOnly, type Cleanup, type ScreenContext } from '../router.js';
import { openDialog } from '../ui/dialog.js';

/** The current kitchen time rounded down to a 15-minute mark. */
function nowOnTheMark(): string {
  const minutes = Number(kitchenHhmm(serverNow()).slice(0, 2)) * 60 + Number(kitchenHhmm(serverNow()).slice(3, 5));
  return minutesToHhmm(Math.floor(minutes / SLOT_MINUTES) * SLOT_MINUTES);
}

export function shiftScreen(context: ScreenContext): Cleanup {
  let date = context.query.get('date') ?? '';

  const heading = el('h1', { text: 'Shift', attrs: { tabindex: '-1' } });
  const sheetHeading = el('h2', {});
  const dateInput = el('input', { attrs: { type: 'text', inputmode: 'numeric', placeholder: 'YYYY-MM-DD' } });
  const dateField = field('Sheet date', dateInput, 'sheet-date');
  const blockButton = el('button', { class: 'btn', text: 'Block station', attrs: { type: 'button' } });
  const shiftStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Shift status', 'aria-live': 'polite' },
  });
  const sheetBody = el('tbody', {});
  const sheetEmpty = el('p', { class: 'empty', text: copy.EMPTY_USAGE_SHEET, attrs: { hidden: true } });

  const table = el('table', { class: 'card-table', attrs: { 'aria-label': 'Usage sheet' } }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Start' }),
        el('th', { text: 'Station' }),
        el('th', { text: 'Renter' }),
        el('th', { text: 'Actual' }),
        el('th', { text: 'Status' }),
        el('th', { class: 'num', text: 'Overage' }),
        el('th', { text: 'Actions' }),
      ]),
    ]),
    sheetBody,
  ]);

  context.root.append(
    heading,
    el('div', { class: 'board__head' }, [dateField.wrapper, blockButton]),
    el('section', { class: 'panel' }, [sheetHeading, table, sheetEmpty, shiftStatus]),
  );

  function sheetTitle(day: string): string {
    return `Usage sheet for ${weekdayName(day)} ${dayOfMonth(day)} ${monthName(
      Number(day.slice(5, 7)),
    )} ${day.slice(0, 4)}`;
  }

  function renderRows(rows: readonly UsageSheetRow[]): void {
    clear(sheetBody);
    for (const row of rows) {
      const checkIn = el('button', {
        class: 'btn',
        text: `Check in ${row.renter_business_name}`,
        attrs: { type: 'button', hidden: row.status !== 'confirmed' },
      });
      const checkOut = el('button', {
        class: 'btn',
        text: `Check out ${row.renter_business_name}`,
        attrs: { type: 'button', hidden: row.status !== 'checked_in' },
      });
      checkIn.addEventListener('click', () => openCheckIn(row, checkIn));
      checkOut.addEventListener('click', () => openCheckOut(row, checkOut));

      sheetBody.append(
        el('tr', {}, [
          el('td', { class: 'num', text: `${row.start}\u2013${row.end}`, attrs: { 'data-label': 'Start' } }),
          el('td', { text: row.station_name, attrs: { 'data-label': 'Station' } }),
          el('td', { text: row.renter_business_name, attrs: { 'data-label': 'Renter' } }),
          el('td', {
            class: 'num',
            text: `${row.actual_start ?? '\u2014'} \u2013 ${row.actual_end ?? '\u2014'}`,
            attrs: { 'data-label': 'Actual' },
          }),
          el('td', { attrs: { 'data-label': 'Status' } }, [
            el('span', { class: 'tag', text: copy.USAGE_ROW_WORDS[row.status] ?? row.status }),
          ]),
          el('td', {
            class: 'num',
            text:
              row.overage_units === null || row.overage_units === 0
                ? '\u2014'
                : `${row.overage_units} \u00d7 15 min \u00b7 $${row.overage_usd ?? '0.00'}`,
            attrs: { 'data-label': 'Overage' },
          }),
          el('td', { attrs: { 'data-label': 'Actions' } }, [
            el('span', { class: 'rowbtns' }, [checkIn, checkOut]),
          ]),
        ]),
      );
    }
    sheetEmpty.hidden = rows.length > 0;
  }

  function openCheckIn(row: UsageSheetRow, opener: HTMLElement): void {
    const input = el('input', { attrs: { type: 'text', value: nowOnTheMark() } });
    const entry = field('Actual start', input, 'actual-start');
    const save = el('button', {
      class: 'btn btn--primary',
      text: 'Record check-in',
      attrs: { type: 'button' },
    });
    const dialog = openDialog({
      label: 'Check in',
      opener,
      body: [el('h2', { text: 'Check in' }), entry.wrapper, el('div', { class: 'dialog__actions' }, [save])],
    });
    save.addEventListener('click', () => {
      save.disabled = true;
      setFieldError(entry.error, null);
      shiftStatus.textContent = copy.SAVING;
      void (async () => {
        try {
          await api.post(`/api/bookings/${row.booking_id}/check-in`, {
            actual_start: input.value.trim(),
          });
          dialog.close({ focus: null });
          shiftStatus.textContent = copy.checkedIn(input.value.trim());
          await load();
        } catch (error) {
          save.disabled = false;
          shiftStatus.textContent = '';
          if (error instanceof ApiError && error.status === 422) {
            setFieldError(entry.error, error.fieldErrors['actual_start'] ?? copy.GENERIC_ERROR);
          } else {
            shiftStatus.textContent = messageFor(error);
          }
        }
      })();
    });
  }

  function openCheckOut(row: UsageSheetRow, opener: HTMLElement): void {
    const input = el('input', { attrs: { type: 'text', value: nowOnTheMark() } });
    const entry = field('Actual end', input, 'actual-end');
    const save = el('button', {
      class: 'btn btn--primary',
      text: 'Record check-out',
      attrs: { type: 'button' },
    });
    const dialog = openDialog({
      label: 'Check out',
      opener,
      body: [el('h2', { text: 'Check out' }), entry.wrapper, el('div', { class: 'dialog__actions' }, [save])],
    });
    save.addEventListener('click', () => {
      save.disabled = true;
      setFieldError(entry.error, null);
      shiftStatus.textContent = copy.SAVING;
      void (async () => {
        try {
          const answer = await api.post<{ booking: { overage_units: number | null; overage_usd: string | null } }>(
            `/api/bookings/${row.booking_id}/check-out`,
            { actual_end: input.value.trim() },
          );
          dialog.close({ focus: null });
          const units = answer.booking.overage_units ?? 0;
          shiftStatus.textContent =
            units > 0
              ? copy.checkedOutWithOverage(units, answer.booking.overage_usd ?? '0.00')
              : copy.CHECKED_OUT_NO_OVERAGE;
          await load();
        } catch (error) {
          save.disabled = false;
          shiftStatus.textContent = '';
          if (error instanceof ApiError && error.status === 422) {
            setFieldError(entry.error, error.fieldErrors['actual_end'] ?? copy.GENERIC_ERROR);
          } else {
            shiftStatus.textContent = messageFor(error, {
              billing_unavailable: copy.CHECKOUT_BILLING_DOWN,
            });
          }
        }
      })();
    });
  }

  async function openBlockDialog(): Promise<void> {
    const stations = await api.get<StationsResponse>(`/api/stations?date=${encodeURIComponent(date)}`);
    const stationSelect = el(
      'select',
      {},
      stations.stations.map((station) =>
        el('option', { text: station.name, attrs: { value: station.id } }),
      ),
    );
    const dateControl = el('input', { attrs: { type: 'text', value: date } });
    const fromControl = el('input', { attrs: { type: 'text', placeholder: 'HH:MM' } });
    const untilControl = el('input', { attrs: { type: 'text', placeholder: 'HH:MM' } });
    const reasonControl = el('input', { attrs: { type: 'text' } });
    const stationField = field('Station', stationSelect, 'block-station');
    const dateEntry = field('Date', dateControl, 'block-date');
    const fromEntry = field('From', fromControl, 'block-from');
    const untilEntry = field('Until', untilControl, 'block-until');
    const reasonEntry = field('Reason', reasonControl, 'block-reason');
    const save = el('button', {
      class: 'btn btn--primary',
      text: 'Save block',
      attrs: { type: 'button' },
    });

    const dialog = openDialog({
      label: 'Block station',
      opener: blockButton,
      body: [
        el('h2', { text: 'Block station' }),
        stationField.wrapper,
        dateEntry.wrapper,
        fromEntry.wrapper,
        untilEntry.wrapper,
        reasonEntry.wrapper,
        el('div', { class: 'dialog__actions' }, [save]),
      ],
    });

    save.addEventListener('click', () => {
      save.disabled = true;
      for (const entry of [dateEntry, fromEntry, untilEntry, reasonEntry]) {
        setFieldError(entry.error, null);
      }
      shiftStatus.textContent = copy.SAVING;
      void (async () => {
        try {
          const answer = await api.post<{ displaced_booking_ids: string[] }>(
            `/api/stations/${stationSelect.value}/maintenance`,
            {
              date: dateControl.value.trim(),
              start: fromControl.value.trim(),
              end: untilControl.value.trim(),
              reason: reasonControl.value.trim(),
            },
          );
          dialog.close({ focus: null });
          shiftStatus.textContent = copy.stationBlocked(answer.displaced_booking_ids.length);
          await load();
        } catch (error) {
          save.disabled = false;
          shiftStatus.textContent = '';
          if (error instanceof ApiError && error.status === 422) {
            const map: Record<string, { error: HTMLElement }> = {
              date: dateEntry,
              start: fromEntry,
              end: untilEntry,
              reason: reasonEntry,
            };
            for (const [key, message] of Object.entries(error.fieldErrors)) {
              const entry = map[key];
              if (entry) setFieldError(entry.error, message);
            }
          } else {
            shiftStatus.textContent = messageFor(error, {
              station_in_use: copy.STATION_IN_USE,
              slot_conflict: copy.STATION_IN_USE,
            });
          }
        }
      })();
    });
  }

  async function load(): Promise<void> {
    const answer = await api.get<UsageSheetResponse>(
      date === '' ? '/api/usage-sheet' : `/api/usage-sheet?date=${encodeURIComponent(date)}`,
    );
    date = answer.date;
    dateInput.value = date;
    sheetHeading.textContent = sheetTitle(date);
    renderRows(answer.rows);
  }

  dateInput.addEventListener('change', () => {
    const wanted = dateInput.value.trim();
    if (!isDateString(wanted)) {
      setFieldError(dateField.error, 'Enter a date as YYYY-MM-DD.');
      return;
    }
    setFieldError(dateField.error, null);
    navigate(`/shift?date=${wanted}`);
  });
  blockButton.addEventListener('click', () => void openBlockDialog());

  inBackground(async () => {
    if (!isDateString(date)) {
      date = '';
      await load();
      replaceAddressOnly(`/shift?date=${date}`);
    } else {
      await load();
    }
    heading.focus();
  });

  return () => undefined;
}

export { kitchenDate };
