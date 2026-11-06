import { call, newIdempotencyKey } from '../lib/api.js';
import { clear, el, focus, setFieldError } from '../lib/dom.js';
import { openDialog, phoneViewport, type DialogHandle } from '../lib/dialog.js';
import { liveRegion, pending, problemsSummary, radioGroup, select, textbox } from '../lib/forms.js';
import { fadeOut, measure, rollNumeral, slideChips } from '../lib/motion.js';
import { pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { requireMember, sessionEndedNotice, isSessionError } from '../lib/session.js';
import { clearDraft, draft, officeOf, saveDraft } from '../lib/store.js';
import { copy, errorCopy, officeTime } from '../lib/copy.js';
import { formatDate, ordinalRank } from '../../shared/format.js';
import { MONTH_SHORT, WEEKDAY_NAMES, parseIsoDate, weekday } from '../../shared/zone.js';
import type {
  Booking,
  ClientRecord,
  Ladder,
  LadderDay,
  OptionRecord,
  TalentRecord,
} from '../../shared/types.js';

type RecentRelease = { optionId: string; clientCompany: string; date: string; releasedAt: string };
type LadderResponse = Ladder & { recentReleases: RecentRelease[] };

type DayDraft = {
  talentId: string;
  date: string;
  client: string;
  jobTitle: string;
  note: string;
  holdUntil: string;
  confirmOpen: boolean;
  dayType: string;
  overtimeMinutes: string;
};

const DAY_DRAFT = 'board-day';
const REFRESH_MS = 5_000;

const FIELD_IDS: Record<string, string> = {
  client: 'day-client',
  clientId: 'day-client',
  jobTitle: 'day-job-title',
  note: 'day-note',
  holdUntilLocal: 'day-hold-until',
  date: 'day-hold-until',
  dayType: 'confirm-day-type-full_day',
  overtimeMinutes: 'confirm-overtime',
  usage: 'confirm-overtime',
  options: 'confirm-overtime',
};

function shortDayLabel(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  if (!date) return isoDate;
  return `${WEEKDAY_NAMES[weekday(date)]} ${date.day} ${MONTH_SHORT[date.month - 1]}`;
}

function longDayLabel(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  return date ? formatDate(date) : isoDate;
}

function chipState(option: OptionRecord): 'option' | 'challenged' | 'booked' | 'released' {
  if (option.state === 'confirmed') return 'booked';
  if (option.state === 'challenged') return 'challenged';
  if (option.state === 'released' || option.state === 'expired') return 'released';
  return 'option';
}

export const boardScreen: Screen = {
  pattern: '/workspace/board',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const member = await requireMember(`${ctx.path}${window.location.search}`);
    if (!member) {
      return { node: el('main', { class: 'page' }, [pageHeading('Board', { display: false })]), chrome: 'plain' };
    }
    const officeId = ctx.query.get('office') ?? member.office;
    const office = await officeOf(officeId);
    const live = liveRegion('Board announcements');

    const talentResult = await call<{ talent: TalentRecord[] }>('GET', `/api/talent?office=${officeId}&state=active`);
    const talent = talentResult.body?.talent ?? [];
    const wantedSlug = ctx.query.get('talent');
    const selected = talent.find((entry) => entry.slug === wantedSlug) ?? talent[0] ?? null;
    const clientsResult = await call<{ clients: ClientRecord[] }>('GET', '/api/clients');
    const clients = clientsResult.body?.clients ?? [];

    const talentList = el('ul', { class: 'talent-list', 'aria-label': 'Talent' }, talent.map((entry) =>
      el('li', {}, [
        el('a', {
          class: 'nav-link',
          href: `/workspace/board?office=${officeId}&talent=${entry.slug}`,
          text: entry.displayName,
          'aria-current': entry.slug === selected?.slug ? 'page' : null,
        }),
      ])));

    const gridWrap = el('div', { class: 'board-strip' });
    const node = el('main', { class: 'page page-workspace page-board-workspace' }, [
      pageHeading('Board', { display: false }),
      el('div', { class: 'board-layout' }, [
        el('div', { class: 'board-talent' }, [el('h2', { class: 'section-heading', text: 'Talent' }), talentList]),
        gridWrap,
      ]),
      live.node,
    ]);

    if (!selected) {
      gridWrap.append(el('p', { class: 'lede', text: 'No talent in this office yet.' }));
      return { node, chrome: 'workspace' };
    }

    let ladder: LadderResponse | null = null;
    const currentLadder = (): LadderResponse | null => ladder;
    let activeDayIndex = 0;
    let openDay: { date: string; dialog: DialogHandle } | null = null;
    const seenReleases = new Set<string>();
    let timer = 0;

    let sessionOver = false;
    const announceSessionEnd = (): void => {
      if (sessionOver) return;
      sessionOver = true;
      window.clearInterval(timer);
      node.append(sessionEndedNotice((message) => live.announce(message)));
    };

    const handleFailure = (code: string | undefined, fallback: string): void => {
      if (isSessionError(code)) {
        if (code === 'access_removed') live.announce(copy.accessRemoved);
        else announceSessionEnd();
        return;
      }
      live.announce(fallback);
    };

    const loadLadder = async (): Promise<LadderResponse | null> => {
      const result = await call<LadderResponse>('GET', `/api/talent/${selected.id}/ladder?days=14`);
      if (!result.body) {
        handleFailure(result.error?.error, 'The board could not be refreshed.');
        return null;
      }
      return result.body;
    };

    const dayButtons = (): HTMLElement[] => [...gridWrap.querySelectorAll<HTMLElement>('.day-button')];

    const focusDay = (index: number): void => {
      const buttons = dayButtons();
      if (buttons.length === 0) return;
      const next = Math.max(0, Math.min(buttons.length - 1, index));
      activeDayIndex = next;
      for (const [position, button] of buttons.entries()) {
        button.tabIndex = position === next ? 0 : -1;
      }
      buttons[next].focus();
    };

    const chipNode = (option: OptionRecord): HTMLElement => {
      const booked = option.state === 'confirmed';
      const rank = option.rank ?? 1;
      const label = booked ? `Booked ${option.clientCompany}` : `${ordinalRank(rank)} ${option.clientCompany}`;
      const numeral = el('span', { class: 'chip-rank', text: booked ? 'Booked' : ordinalRank(rank) });
      const chip = el(
        'span',
        {
          class: 'chip',
          'data-rank': String(rank),
          'data-state': chipState(option),
          'data-chip-id': option.id,
          'aria-label': label,
        },
        [numeral, ' ', el('span', { class: 'chip-company', text: option.clientCompany })],
      );
      if (option.state === 'challenged' && option.challengeDeadline) {
        chip.append(
          el('span', {
            class: 'chip-flag',
            'aria-hidden': 'true',
            text: `Challenged until ${officeTime(option.challengeDeadline, office)}`,
          }),
        );
      }
      return chip;
    };

    const drawGrid = (data: LadderResponse, previous: Map<string, DOMRect>): void => {
      clear(gridWrap);
      const grid = el('div', {
        role: 'grid',
        'aria-label': `Availability for ${selected.displayName}`,
        class: 'day-grid',
      });
      const rows: LadderDay[][] = [data.days.slice(0, 7), data.days.slice(7, 14)];
      for (const rowDays of rows) {
        const row = el('div', { role: 'row', class: 'day-row' });
        for (const day of rowDays) {
          const booked = day.dayState === 'booked';
          const button = el('button', {
            type: 'button',
            class: 'day-button',
            'data-day-state': day.dayState,
            'data-date': day.date,
            tabindex: '-1',
          }, [el('span', { class: 'day-label', text: shortDayLabel(day.date) }), ' ']);
          const chips = el('span', { class: 'chip-stack' });
          const visible = day.options.filter((option) => option.state !== 'released' && option.state !== 'expired');
          if (visible.length === 0) {
            chips.append(el('span', { class: 'chip chip-open', text: 'Open' }));
          }
          for (const option of visible) {
            chips.append(chipNode(option), ' ');
          }
          button.append(chips);
          button.addEventListener('click', () => {
            activeDayIndex = data.days.findIndex((entry) => entry.date === day.date);
            openDayDialog(day, button);
          });
          const cell = el('div', { role: 'gridcell', class: 'day-cell' }, [button]);
          if (booked && day.bookingId) {
            cell.append(
              el('a', {
                class: 'link view-booking',
                href: `/workspace/bookings/${day.bookingId}`,
                text: `View booking ${bookingReferences.get(day.bookingId) ?? ''}`.trim(),
                'data-booking-id': day.bookingId,
              }),
            );
          }
          row.append(cell);
        }
        grid.append(row);
      }
      grid.addEventListener('keydown', (event) => {
        const keys: Record<string, number> = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -7,
          ArrowDown: 7,
        };
        if (event.key in keys) {
          event.preventDefault();
          focusDay(activeDayIndex + keys[event.key]);
          return;
        }
        if (event.key === 'Home') {
          event.preventDefault();
          focusDay(0);
          return;
        }
        if (event.key === 'End') {
          event.preventDefault();
          focusDay(data.days.length - 1);
        }
      });
      gridWrap.append(grid);
      const buttons = dayButtons();
      for (const [position, button] of buttons.entries()) button.tabIndex = position === activeDayIndex ? 0 : -1;
      slideChips(gridWrap.querySelectorAll<HTMLElement>('.chip'), previous);
    };

    const bookingReferences = new Map<string, string>();

    const refreshBookingReferences = async (data: LadderResponse): Promise<void> => {
      for (const day of data.days) {
        if (!day.bookingId || bookingReferences.has(day.bookingId)) continue;
        const result = await call<{ booking: Booking }>('GET', `/api/bookings/${day.bookingId}`);
        if (result.body) bookingReferences.set(day.bookingId, result.body.booking.reference);
      }
    };

    const announceSweep = (data: LadderResponse): void => {
      for (const release of data.recentReleases) {
        if (seenReleases.has(release.optionId)) continue;
        seenReleases.add(release.optionId);
        if (!ladder) continue;
        live.announce(
          `${release.clientCompany}'s option on ${longDayLabel(release.date)} was released at ${officeTime(release.releasedAt, office)}.`,
        );
      }
    };

    let signature = '';

    const signatureOf = (data: LadderResponse): string =>
      data.days
        .map((day) =>
          `${day.date}:${day.dayState}:${day.bookingId ?? ''}:${day.options
            .map((option) => `${option.id}/${option.rank}/${option.state}/${option.challengeDeadline ?? ''}`)
            .join('|')}`)
        .join(';');

    const refresh = async (): Promise<void> => {
      const data = await loadLadder();
      if (!data) return;
      await refreshBookingReferences(data);
      announceSweep(data);
      const nextSignature = signatureOf(data);
      if (nextSignature === signature && gridWrap.querySelector('.day-grid')) {
        ladder = data;
        return;
      }
      const previous = measure(gridWrap.querySelectorAll<HTMLElement>('.chip'));
      const promoted = findPromotions(ladder, data);
      const activeDate = (document.activeElement as HTMLElement | null)?.dataset?.date ?? null;
      const stillShown = new Set(
        data.days.flatMap((day) => day.options)
          .filter((option) => option.state !== 'released' && option.state !== 'expired')
          .map((option) => option.id),
      );
      const leaving = [...gridWrap.querySelectorAll<HTMLElement>('.chip[data-chip-id]')]
        .filter((chip) => !stillShown.has(chip.dataset.chipId ?? ''));
      for (const chip of leaving) chip.dataset.state = 'released';
      if (leaving.length > 0) await Promise.all(leaving.map((chip) => fadeOut(chip)));
      ladder = data;
      signature = nextSignature;
      drawGrid(data, previous);
      if (activeDate) {
        const index = data.days.findIndex((day) => day.date === activeDate);
        if (index !== -1) focusDay(index);
      }
      for (const [optionId, steps] of promoted) {
        const numeral = gridWrap.querySelector<HTMLElement>(`[data-chip-id="${optionId}"] .chip-rank`);
        if (numeral) rollNumeral(numeral, steps);
      }
      if (openDay) {
        const day = data.days.find((entry) => entry.date === openDay?.date);
        if (day) paintDialog(openDay.dialog, day);
      }
    };

    function findPromotions(before: LadderResponse | null, after: LadderResponse): Array<[string, number]> {
      if (!before) return [];
      const ranks = new Map<string, number>();
      for (const day of before.days) {
        for (const option of day.options) if (option.rank !== null) ranks.set(option.id, option.rank);
      }
      const promotions: Array<[string, number]> = [];
      for (const day of after.days) {
        for (const option of day.options) {
          const previousRank = ranks.get(option.id);
          if (option.rank !== null && previousRank !== undefined && option.rank < previousRank) {
            promotions.push([option.id, previousRank - option.rank]);
          }
        }
      }
      return promotions;
    }

    function paintDialog(dialog: DialogHandle, day: LadderDay): void {
      const list = dialog.body.querySelector<HTMLElement>('.dialog-chips');
      if (!list) return;
      clear(list);
      const live1 = day.options.filter((option) => option.state !== 'released' && option.state !== 'expired');
      for (const option of live1) {
        const row = el('div', { class: 'dialog-chip-row' }, [chipNode(option)]);
        const actions = el('div', { class: 'dialog-chip-actions' });
        if (option.state !== 'confirmed') {
          const release = el('button', { type: 'button', class: 'button button-quiet', text: 'Release' });
          release.addEventListener('click', () => void releaseOption(option, release, dialog, day));
          actions.append(release);
          if (option.rank === 1) {
            const confirmButton = el('button', { type: 'button', class: 'button', text: 'Confirm' });
            confirmButton.addEventListener('click', () => openConfirmDialog(option, day, dialog));
            actions.append(confirmButton);
          }
          if (option.rank === 2) {
            const challenge = el('button', { type: 'button', class: 'button button-quiet', text: 'Challenge' });
            challenge.addEventListener('click', () => void challengeOption(option, challenge, dialog, day));
            actions.append(challenge);
          }
        }
        row.append(actions);
        list.append(row);
      }
      if (live1.length === 0) list.append(el('p', { class: 'lede', text: 'This day is open.' }));
    }

    async function releaseOption(
      option: OptionRecord,
      button: HTMLButtonElement,
      dialog: DialogHandle,
      day: LadderDay,
    ): Promise<void> {
      const spinner = pending(button, 'Releasing…');
      spinner.start();
      const result = await call<{ option: OptionRecord; ladder: OptionRecord[] }>(
        'POST',
        `/api/options/${option.id}/release`,
        { body: {} },
      );
      spinner.stop();
      if (result.body) {
        const nextFirst = result.body.ladder.find((entry) => entry.rank === 1);
        const extra = option.rank === 1 && nextFirst ? ` ${nextFirst.clientCompany} now holds 1st.` : '';
        live.announce(`Released ${option.clientCompany}'s option.${extra}`);
        dialog.close();
        openDay = null;
        await refresh();
        focusDay(activeDayIndex);
        return;
      }
      showDialogRefusal(dialog, result.error?.error, {
        option_released: () => `This option was released at ${officeTime(String(result.error?.releasedAt ?? ''), office)}.`,
        challenge_expired: () =>
          `The challenge deadline passed at ${officeTime(String(result.error?.challengeDeadline ?? ''), office)}, so this option is being released.`,
      }, day);
    }

    async function challengeOption(
      option: OptionRecord,
      button: HTMLButtonElement,
      dialog: DialogHandle,
      day: LadderDay,
    ): Promise<void> {
      const spinner = pending(button, 'Sending challenge…');
      spinner.start();
      const result = await call<{ ladder: OptionRecord[] }>('POST', `/api/options/${option.id}/challenge`, {
        body: {},
      });
      spinner.stop();
      if (result.body) {
        const challenged = result.body.ladder.find((entry) => entry.rank === 1);
        live.announce(
          `Challenged ${challenged?.clientCompany ?? ''}'s 1st option. It must be answered by ${officeTime(challenged?.challengeDeadline ?? null, office)}.`,
        );
        dialog.close();
        openDay = null;
        await refresh();
        focusDay(activeDayIndex);
        return;
      }
      showDialogRefusal(dialog, result.error?.error, {
        not_second: () => 'Only the 2nd option can challenge the 1st.',
        already_challenged: () =>
          `The 1st option is already challenged until ${officeTime(String(result.error?.challengeDeadline ?? ''), office)}.`,
        option_released: () => `This option was released at ${officeTime(String(result.error?.releasedAt ?? ''), office)}.`,
      }, day);
    }

    function showDialogRefusal(
      dialog: DialogHandle,
      code: string | undefined,
      perCode: Record<string, () => string>,
      day: LadderDay,
    ): void {
      if (isSessionError(code)) {
        const draftValues = readDialogDraft(dialog, day);
        saveDraft(DAY_DRAFT, draftValues);
        dialog.close();
        openDay = null;
        if (code === 'access_removed') live.announce(copy.accessRemoved);
        else announceSessionEnd();
        return;
      }
      const message = code && perCode[code]
        ? perCode[code]()
        : errorCopy({ error: code ?? 'server_error' }, office);
      const refusal = dialog.body.querySelector<HTMLElement>('.dialog-refusal');
      if (refusal) {
        refusal.textContent = `Error: ${message}`;
        refusal.hidden = false;
        focus(refusal);
      }
      live.announce(message);
    }

    function readDialogDraft(dialog: DialogHandle, day: LadderDay): DayDraft {
      const value = (id: string): string =>
        dialog.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)?.value ?? '';
      return {
        talentId: selected.id,
        date: day.date,
        client: value(FIELD_IDS.client),
        jobTitle: value(FIELD_IDS.jobTitle),
        note: value(FIELD_IDS.note),
        holdUntil: value(FIELD_IDS.holdUntilLocal),
        confirmOpen: false,
        dayType: 'full_day',
        overtimeMinutes: '',
      };
    }

    function openDayDialog(day: LadderDay, trigger: HTMLElement, restored?: DayDraft): void {
      const dialog = openDialog({
        title: `${selected.displayName}, ${longDayLabel(day.date)}`,
        sheet: phoneViewport(),
        returnFocusTo: trigger,
        onClose: () => {
          openDay = null;
        },
      });
      openDay = { date: day.date, dialog };

      const problems = problemsSummary();
      const refusal = el('p', { class: 'dialog-refusal field-error', hidden: true, tabindex: '-1' });
      const chipList = el('div', { class: 'dialog-chips' });
      const client = textbox({ id: FIELD_IDS.client, label: 'Client', value: restored?.client ?? '' });
      const jobTitle = textbox({ id: FIELD_IDS.jobTitle, label: 'Job title', value: restored?.jobTitle ?? '' });
      const note = textbox({ id: FIELD_IDS.note, label: 'Note', value: restored?.note ?? '', multiline: true });
      const holdUntil = textbox({
        id: FIELD_IDS.holdUntilLocal,
        label: 'Hold until',
        value: restored?.holdUntil ?? '',
      });
      holdUntil.input.setAttribute('placeholder', 'YYYY-MM-DD HH:MM');
      const place = el('button', { type: 'button', class: 'button', text: 'Place option' });

      place.addEventListener('click', async () => {
        problems.hide(dialog.body, FIELD_IDS);
        refusal.hidden = true;
        const company = client.input.value.trim();
        const match = clients.find((entry) => entry.company.toLowerCase() === company.toLowerCase());
        if (!match) {
          setFieldError(dialog.body, FIELD_IDS.client, company ? 'No client matches that company.' : 'Enter client.');
          live.announce(copy.validation(1));
          focus(client.input);
          return;
        }
        const spinner = pending(place, 'Placing option…');
        spinner.start();
        const result = await call<{ option: OptionRecord }>('POST', '/api/options', {
          idempotencyKey: newIdempotencyKey(),
          body: {
            talentId: selected.id,
            clientId: match.id,
            date: day.date,
            jobTitle: jobTitle.input.value,
            note: note.input.value || null,
            holdUntilLocal: holdUntil.input.value.trim().replace(' ', 'T') || null,
          },
        });
        spinner.stop();
        if (result.body) {
          clearDraft(DAY_DRAFT);
          live.announce(
            `Placed ${ordinalRank(result.body.option.rank ?? 1)} option for ${match.company} on ${longDayLabel(day.date)}.`,
          );
          dialog.close();
          openDay = null;
          await refresh();
          focusDay(activeDayIndex);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          problems.show(result.error.errors, FIELD_IDS, dialog.body);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          const firstId = FIELD_IDS[Object.keys(result.error.errors)[0]];
          focus(dialog.body.querySelector<HTMLElement>(`#${firstId}`));
          return;
        }
        showDialogRefusal(dialog, result.error?.error, {
          ladder_full: () => 'This day already holds three options.',
          client_already_holds: () => `${match.company} already holds an option on this day.`,
          day_booked: () => 'This day is already booked.',
        }, day);
      });

      dialog.body.append(
        problems.node,
        refusal,
        chipList,
        el('div', { class: 'dialog-form' }, [
          client.field,
          jobTitle.field,
          note.field,
          holdUntil.field,
        ]),
        el('div', { class: 'sticky-bar dialog-actions' }, [place]),
      );
      paintDialog(dialog, day);
      focus(dialog.body.querySelector<HTMLElement>('button, input'));
    }

    function openConfirmDialog(option: OptionRecord, day: LadderDay, parent: DialogHandle): void {
      const dialog = openDialog({ title: 'Confirm booking', sheet: phoneViewport() });
      const refusal = el('p', { class: 'dialog-refusal field-error', hidden: true, tabindex: '-1' });
      const dayType = radioGroup({
        name: 'confirm-day-type',
        label: 'Day type',
        value: 'full_day',
        choices: [
          { value: 'full_day', label: 'Full day' },
          { value: 'half_day', label: 'Half day' },
        ],
      });
      const overtime = textbox({
        id: FIELD_IDS.overtimeMinutes,
        label: 'Overtime minutes',
        value: '0',
        inputmode: 'numeric',
      });
      const usageWrap = el('div', { class: 'usage-rows' });
      const addUsage = el('button', { type: 'button', class: 'button button-quiet', text: 'Add usage' });
      let usageIndex = 0;
      addUsage.addEventListener('click', () => {
        usageIndex += 1;
        const media = select({
          id: `usage-media-${usageIndex}`,
          label: 'Media',
          value: 'digital',
          choices: [
            { value: 'digital', label: 'Digital' },
            { value: 'print', label: 'Print' },
            { value: 'out_of_home', label: 'Out of home' },
            { value: 'broadcast', label: 'Broadcast' },
          ],
        });
        const territory = select({
          id: `usage-territory-${usageIndex}`,
          label: 'Territory',
          value: 'canada',
          choices: [
            { value: 'canada', label: 'Canada' },
            { value: 'north_america', label: 'North America' },
            { value: 'worldwide', label: 'Worldwide' },
          ],
        });
        const term = select({
          id: `usage-term-${usageIndex}`,
          label: 'Term',
          value: '3',
          choices: [
            { value: '3', label: '3 months' },
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
          ],
        });
        const group = el('div', { class: 'usage-row', role: 'group', 'aria-label': `Usage ${usageIndex}` }, [
          media.field,
          territory.field,
          term.field,
        ]);
        usageWrap.append(group);
        focus(media.node);
      });

      const alsoBook = el('div', { role: 'group', 'aria-label': 'Also book', class: 'also-book' });
      const companions: Array<{ optionId: string; input: HTMLInputElement }> = [];
      void (async (): Promise<void> => {
        for (const entry of talent) {
          if (entry.id === selected.id) continue;
          const result = await call<LadderResponse>(
            'GET',
            `/api/talent/${entry.id}/ladder?from=${day.date}&days=1`,
          );
          const other = result.body?.days[0]?.options.find(
            (candidate) => candidate.rank === 1 && candidate.clientId === option.clientId
              && (candidate.state === 'placed' || candidate.state === 'challenged'),
          );
          if (!other) continue;
          const id = `also-${entry.id}`;
          const input = el('input', { type: 'checkbox', id, class: 'checkbox' });
          companions.push({ optionId: other.id, input });
          alsoBook.append(
            el('div', { class: 'checkbox-row' }, [input, el('label', { for: id, text: entry.displayName })]),
          );
        }
      })();

      const confirmButton = el('button', { type: 'button', class: 'button', text: 'Confirm booking' });
      confirmButton.addEventListener('click', async () => {
        refusal.hidden = true;
        const usage = [...usageWrap.querySelectorAll<HTMLElement>('.usage-row')].map((row) => {
          const values = [...row.querySelectorAll<HTMLSelectElement>('select')].map((node) => node.value);
          return { media: values[0], territory: values[1], termMonths: Number(values[2]) };
        });
        const optionPayload = {
          dayType: dayType.value(),
          overtimeMinutes: Number.parseInt(overtime.input.value || '0', 10),
          usage,
        };
        const options = [
          { optionId: option.id, ...optionPayload },
          ...companions
            .filter((companion) => companion.input.checked)
            .map((companion) => ({ optionId: companion.optionId, ...optionPayload })),
        ];
        const spinner = pending(confirmButton, 'Confirming booking…');
        spinner.start();
        const result = await call<{ booking: Booking }>('POST', '/api/bookings', { body: { options } });
        spinner.stop();
        if (result.body) {
          const booking = result.body.booking;
          bookingReferences.set(booking.id, booking.reference);
          live.announce(
            `Booked ${booking.talent.map((entry) => entry.displayName).join(', ')} for ${booking.clientCompany} on ${longDayLabel(booking.date)}. The confirmation email is on its way.`,
          );
          dialog.close();
          parent.close();
          openDay = null;
          await refresh();
          const link = gridWrap.querySelector<HTMLElement>(`[data-booking-id="${booking.id}"]`);
          focus(link);
          return;
        }
        if (result.status === 422 && result.error?.errors) {
          const errors = result.error.errors;
          for (const [field, message] of Object.entries(errors)) {
            setFieldError(dialog.body, FIELD_IDS[field] ?? FIELD_IDS.overtimeMinutes, message);
          }
          live.announce(copy.validation(Object.keys(errors).length));
          focus(dialog.body.querySelector<HTMLElement>(`#${FIELD_IDS[Object.keys(errors)[0]] ?? FIELD_IDS.overtimeMinutes}`));
          return;
        }
        const code = result.error?.error;
        if (code === 'billing_unavailable') {
          refusal.textContent = `Error: ${copy.confirmBillingOutage}`;
          refusal.hidden = false;
          focus(refusal);
          live.announce(copy.confirmBillingOutage);
          return;
        }
        showDialogRefusalIn(dialog, refusal, code, {
          already_booked: () =>
            `Not booked: ${String(result.error?.bookedBy ?? '')} confirmed this day first, at ${officeTime(String(result.error?.bookedAt ?? ''), office)}.`,
          not_first: () => 'Only the 1st option can be confirmed.',
          option_released: () => `This option was released at ${officeTime(String(result.error?.releasedAt ?? ''), office)}.`,
          challenge_expired: () =>
            `The challenge deadline passed at ${officeTime(String(result.error?.challengeDeadline ?? ''), office)}, so this option is being released.`,
        });
      });

      dialog.body.append(
        refusal,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Day type' }), dayType.node]),
        overtime.field,
        addUsage,
        usageWrap,
        el('div', { class: 'field' }, [el('span', { class: 'field-label', text: 'Also book' }), alsoBook]),
        el('div', { class: 'sticky-bar dialog-actions' }, [confirmButton]),
      );
      focus(dialog.body.querySelector<HTMLElement>('input'));
    }

    function showDialogRefusalIn(
      dialog: DialogHandle,
      refusal: HTMLElement,
      code: string | undefined,
      perCode: Record<string, () => string>,
    ): void {
      if (isSessionError(code)) {
        dialog.close();
        if (code === 'access_removed') live.announce(copy.accessRemoved);
        else announceSessionEnd();
        return;
      }
      const message = code && perCode[code] ? perCode[code]() : errorCopy({ error: code ?? 'server_error' }, office);
      refusal.textContent = `Error: ${message}`;
      refusal.hidden = false;
      focus(refusal);
      live.announce(message);
    }

    await refresh();
    for (const release of currentLadder()?.recentReleases ?? []) seenReleases.add(release.optionId);

    const restoredDraft = draft<DayDraft | null>(DAY_DRAFT, null);

    return {
      node,
      chrome: 'workspace',
      onLeave: (): void => window.clearInterval(timer),
      onMounted: (): void => {
        timer = window.setInterval(() => {
          if (!sessionOver) void refresh();
        }, REFRESH_MS);
        const data = currentLadder();
        if (restoredDraft && restoredDraft.talentId === selected.id && data) {
          const day = data.days.find((entry) => entry.date === restoredDraft.date);
          const button = gridWrap.querySelector<HTMLElement>(`[data-date="${restoredDraft.date}"]`);
          if (day && button) {
            clearDraft(DAY_DRAFT);
            openDayDialog(day, button, restoredDraft);
            live.announce(copy.draftRestored);
          }
        }
      },
    };
  },
};
