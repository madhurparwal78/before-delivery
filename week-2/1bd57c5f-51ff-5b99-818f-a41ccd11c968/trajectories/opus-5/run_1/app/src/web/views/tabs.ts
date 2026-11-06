import {
  COPY,
  ROLE_LABELS,
  TRADE_KEYS,
  TRADE_LABELS,
  tradeLabel,
  VISIT_STATUS_LABELS,
} from '../../shared/domain.js';
import { remove, sendForm, sendJson } from '../lib/api.js';
import {
  button,
  el,
  labelledField,
  money,
  openDialog,
  option,
  setFieldError,
} from '../lib/dom.js';
import { announce, errorSummary } from '../lib/shell.js';
import type { ChangeOrder, Member, Room, Visit } from '../lib/types.js';
import { fieldMessages, messageOf, offlineNow, withPending, type JobCtx } from './jobctx.js';

export function jobLocal(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
}

function localMinutes(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

function table(label: string, headings: string[], rows: (Node | string)[][]): HTMLElement {
  return el('table', { 'aria-label': label, class: 'ledger' }, [
    el('thead', {}, [el('tr', {}, headings.map((heading) => el('th', {}, [heading])))]),
    el(
      'tbody',
      {},
      rows.map((cells) => el('tr', {}, cells.map((cell) => el('td', {}, [cell])))),
    ),
  ]);
}

/* ------------------------------------------------------------- corner text */

export function cornersToText(outline: { x: number; y: number }[]): string {
  return outline
    .map((point) => `${trimPercent(point.x * 100)},${trimPercent(point.y * 100)}`)
    .join('; ');
}

function trimPercent(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function parseCorners(text: string): { x: number; y: number }[] | null {
  const pairs = text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const out: { x: number; y: number }[] = [];
  for (const pair of pairs) {
    const match = /^(\d+(?:\.\d{1,2})?)\s*,\s*(\d+(?:\.\d{1,2})?)$/.exec(pair);
    if (match === null) return null;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x > 100 || y > 100) return null;
    out.push({ x: Math.round(x * 100) / 10000, y: Math.round(y * 100) / 10000 });
  }
  return out.length === 0 ? null : out;
}

export function parseReferencePoints(
  text: string,
): { old: { x: number; y: number }; new: { x: number; y: number } }[] | null {
  const parts = text
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const out: { old: { x: number; y: number }; new: { x: number; y: number } }[] = [];
  for (const part of parts) {
    const halves = part.split('>');
    if (halves.length !== 2) return null;
    const from = parseCorners(halves[0]);
    const to = parseCorners(halves[1]);
    if (from === null || to === null || from.length !== 1 || to.length !== 1) return null;
    out.push({ old: from[0], new: to[0] });
  }
  return out;
}

/* --------------------------------------------------------------- setup tab */

export function setupPanel(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const panel = el('div', { class: 'tabpanelbody setup' });
  const planForm = labelledField('Upload plan', { type: 'file', accept: 'image/*' });
  const planInput = planForm.input as HTMLInputElement;
  planInput.hidden = true;
  const upload = button('Upload plan', { 'data-fk': 'uploadplan' }, () => planInput.click());
  planInput.addEventListener('change', () => {
    const file = planInput.files?.[0];
    if (file === undefined) return;
    void (async () => {
      const form = new FormData();
      form.append('file', file);
      const done = await withPending(
        upload,
        () => sendForm('PUT', `/api/jobs/${ctx.state.jobId}/plan`, form),
        () => 'Plan uploaded.',
        (message) => message,
      );
      if (done !== null) await ctx.state.refresh();
      ctx.render();
    })();
  });
  panel.append(el('div', { class: 'planupload' }, [upload, planForm.wrap]));

  if (data.job.plan_revision !== null) {
    panel.append(
      button('Upload revision', { 'data-fk': 'uploadrevision' }, (event) =>
        openRevisionDialog(ctx, event.currentTarget as HTMLButtonElement),
      ),
    );
  }

  panel.append(
    table(
      'Plan revisions',
      ['Revision', 'Uploaded by', 'Uploaded at', 'Pins moved', 'Need review'],
      data.revisions.map((revision) => [
        el('span', { class: 'num' }, [String(revision.revision)]),
        revision.uploaded_by.name,
        el('span', { class: 'num' }, [jobLocal(revision.created_at, data.job.time_zone)]),
        el('span', { class: 'num' }, [String(revision.moved)]),
        el('span', { class: 'num' }, [String(revision.needs_review)]),
      ]),
    ),
  );

  const addRoom = button('Add room', { 'data-fk': 'addroom' }, (event) =>
    openAddRoom(ctx, event.currentTarget as HTMLButtonElement),
  );
  addRoom.disabled = offlineNow();
  panel.append(
    el('div', { class: 'roomsetup' }, [
      addRoom,
      el(
        'ul',
        { class: 'roomnames' },
        data.rooms.map((room: Room) =>
          el('li', {}, [
            el('span', {}, [room.name]),
            el('span', { class: 'num' }, [cornersToText(room.outline)]),
          ]),
        ),
      ),
    ]),
  );
  return panel;
}

function openAddRoom(ctx: JobCtx, opener: HTMLButtonElement): void {
  openDialog(
    'Add room',
    (dialog) => {
      const name = labelledField('Room name');
      const corners = labelledField('Corners');
      const problem = el('div', { class: 'formproblem' });
      dialog.body.append(
        problem,
        name.wrap,
        corners.wrap,
        button('Save room', {}, (event) => {
          void (async () => {
            problem.replaceChildren();
            setFieldError(corners.error, corners.input, null);
            setFieldError(name.error, name.input, null);
            const outline = parseCorners((corners.input as HTMLInputElement).value);
            if (outline === null) {
              setFieldError(
                corners.error,
                corners.input,
                'Give corners as x,y percent pairs separated by semicolons.',
              );
              return;
            }
            const control = event.currentTarget as HTMLButtonElement;
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
            announce(COPY.saving);
            try {
              await sendJson('POST', `/api/jobs/${ctx.state.jobId}/rooms`, {
                name: (name.input as HTMLInputElement).value,
                outline,
              });
              announce('Room saved.');
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            } catch (error) {
              const fields = fieldMessages(error);
              const entries: { field: string; message: string; focus: () => void }[] = [];
              if (fields.outline !== undefined) {
                setFieldError(corners.error, corners.input, fields.outline);
                entries.push({
                  field: 'outline',
                  message: fields.outline,
                  focus: () => corners.input.focus(),
                });
              }
              if (fields.name !== undefined) {
                setFieldError(name.error, name.input, fields.name);
                entries.push({
                  field: 'name',
                  message: fields.name,
                  focus: () => name.input.focus(),
                });
              }
              if (entries.length === 0) {
                setFieldError(corners.error, corners.input, messageOf(error));
                entries.push({
                  field: 'outline',
                  message: messageOf(error),
                  focus: () => corners.input.focus(),
                });
              }
              const summary = errorSummary(entries);
              if (summary !== null) problem.append(summary);
              announce('');
            } finally {
              control.disabled = false;
              control.removeAttribute('aria-busy');
            }
          })();
        }),
      );
    },
    opener,
  );
}

function openRevisionDialog(ctx: JobCtx, opener: HTMLButtonElement): void {
  const data = ctx.state.data!;
  openDialog(
    'Upload plan revision',
    (dialog) => {
      const image = labelledField('Revision image', { type: 'file', accept: 'image/*' });
      const points = labelledField('Reference points');
      const roomFields = data.rooms.map((room) => {
        const field = labelledField(`${room.name} corners`);
        (field.input as HTMLInputElement).value = cornersToText(room.outline);
        return { room, field };
      });
      const problem = el('div', { class: 'formproblem' });
      dialog.body.append(problem, image.wrap, points.wrap, ...roomFields.map((entry) => entry.field.wrap));
      dialog.body.append(
        button('Upload revision', {}, (event) => {
          void (async () => {
            problem.replaceChildren();
            setFieldError(points.error, points.input, null);
            const parsed = parseReferencePoints((points.input as HTMLInputElement).value);
            if (parsed === null) {
              setFieldError(
                points.error,
                points.input,
                'Give three pairs written old x,old y > new x,new y.',
              );
              return;
            }
            const rooms = roomFields.map((entry) => ({
              room_id: entry.room.id,
              outline: parseCorners((entry.field.input as HTMLInputElement).value),
            }));
            const broken = rooms.find((entry) => entry.outline === null);
            if (broken !== undefined) {
              const field = roomFields.find((entry) => entry.room.id === broken.room_id)!.field;
              setFieldError(field.error, field.input, 'Give corners as x,y percent pairs.');
              return;
            }
            const file = (image.input as HTMLInputElement).files?.[0];
            if (file === undefined) {
              setFieldError(image.error, image.input, 'Choose a plan image.');
              return;
            }
            const form = new FormData();
            form.append('file', file);
            form.append('reference_points', JSON.stringify(parsed));
            form.append('rooms', JSON.stringify(rooms));
            const control = event.currentTarget as HTMLButtonElement;
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
            announce(COPY.saving);
            try {
              const result = await sendForm<{
                revision: number;
                moved: number;
                needs_review: number;
              }>('POST', `/api/jobs/${ctx.state.jobId}/plan/revisions`, form);
              announce(
                `Plan revision ${result.revision} uploaded: ${result.moved} pins moved, ${result.needs_review} need review.`,
              );
              ctx.ui.planViewport = null;
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            } catch (error) {
              const fields = fieldMessages(error);
              const entries: { field: string; message: string; focus: () => void }[] = [];
              if (fields.reference_points !== undefined) {
                setFieldError(points.error, points.input, fields.reference_points);
                entries.push({
                  field: 'reference_points',
                  message: fields.reference_points,
                  focus: () => points.input.focus(),
                });
              }
              if (fields.rooms !== undefined) {
                const first = roomFields[0];
                setFieldError(first.field.error, first.field.input, fields.rooms);
                entries.push({
                  field: 'rooms',
                  message: fields.rooms,
                  focus: () => first.field.input.focus(),
                });
              }
              if (entries.length === 0) {
                setFieldError(image.error, image.input, messageOf(error));
                entries.push({
                  field: 'file',
                  message: messageOf(error),
                  focus: () => image.input.focus(),
                });
              }
              const summary = errorSummary(entries);
              if (summary !== null) problem.append(summary);
              announce('');
            } finally {
              control.disabled = false;
              control.removeAttribute('aria-busy');
            }
          })();
        }),
      );
    },
    opener,
  );
}

/* ----------------------------------------------------- people and visits */

export function peoplePanel(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const panel = el('div', { class: 'tabpanelbody people' });
  const isOwner = data.job.my_role === 'owner';

  if (isOwner) {
    const add = button('Add person', { 'data-fk': 'addperson' }, (event) =>
      openAddPerson(ctx, event.currentTarget as HTMLButtonElement),
    );
    add.disabled = offlineNow();
    panel.append(add);
  }
  panel.append(
    table(
      'People',
      ['Name', 'Role', 'Trade', 'Email', 'Phone', ''],
      data.members.map((member) => [
        member.name,
        ROLE_LABELS[member.role],
        member.trade === null ? 'Crew' : TRADE_LABELS[member.trade],
        member.email ?? '',
        member.phone ?? '',
        isOwner && member.role !== 'owner' ? endRoleButton(ctx, member) : '',
      ]),
    ),
  );

  const schedule = button('Schedule visit', { 'data-fk': 'schedulevisit' }, (event) =>
    openScheduleVisit(ctx, event.currentTarget as HTMLButtonElement),
  );
  schedule.disabled = offlineNow();
  panel.append(schedule);

  const rows: (Node | string)[][] = [];
  const occurrences = data.visits.flatMap((visit) =>
    visit.occurrences.map((occurrence, index) => ({ visit, occurrence, first: index === 0 })),
  );
  occurrences.sort((a, b) => a.occurrence.starts_at.localeCompare(b.occurrence.starts_at));
  for (const entry of occurrences) {
    const starts = localMinutes(entry.occurrence.starts_at);
    const controls = el('div', { class: 'visitcontrols' });
    if (entry.occurrence.status !== 'cancelled') {
      controls.append(
        button(`Move visit on ${starts}`, { 'data-fk': `movevisit-${entry.occurrence.date}` }, (event) =>
          openMoveVisit(ctx, entry.visit, entry.occurrence.date, starts, event.currentTarget as HTMLButtonElement),
        ),
        button(
          `Cancel visit on ${starts}`,
          { 'data-fk': `cancelvisit-${entry.occurrence.date}` },
          (event) => void cancelOccurrence(ctx, entry.visit, entry.occurrence.date, event.currentTarget as HTMLButtonElement),
        ),
      );
    }
    if (entry.first) {
      controls.append(
        button(
          `Delete visit on ${starts}`,
          { 'data-fk': `deletevisit-${entry.visit.id}` },
          (event) => void deleteSeries(ctx, entry.visit, event.currentTarget as HTMLButtonElement),
        ),
      );
    }
    rows.push([
      entry.visit.member_name,
      el('span', { class: 'num' }, [starts]),
      el('span', { class: 'num' }, [localMinutes(entry.occurrence.ends_at)]),
      VISIT_STATUS_LABELS[entry.occurrence.status],
      controls,
    ]);
  }
  panel.append(table('Site visits', ['Person', 'Starts', 'Ends', 'Status', ''], rows));
  return panel;
}

function endRoleButton(ctx: JobCtx, member: Member): HTMLElement {
  const control = button(`End role for ${member.name}`, { 'data-fk': `endrole-${member.id}` }, (event) => {
    const opener = event.currentTarget as HTMLButtonElement;
    openDialog(
      'End role',
      (dialog) => {
        dialog.body.append(
          el('p', {}, [`${member.name} loses access to this job.`]),
          button('End role', {}, (inner) => {
            void (async () => {
              const done = await withPending(
                inner.currentTarget as HTMLButtonElement,
                async () => {
                  await remove(`/api/jobs/${ctx.state.jobId}/members/${member.id}`);
                  return true;
                },
                () => `Role ended for ${member.name}.`,
                (message) => message,
              );
              if (done !== null) {
                await ctx.state.refresh();
                dialog.close();
                ctx.render();
              }
            })();
          }),
        );
      },
      opener,
    );
  });
  control.disabled = offlineNow();
  return control;
}

function openAddPerson(ctx: JobCtx, opener: HTMLButtonElement): void {
  openDialog(
    'Add person',
    (dialog) => {
      const name = labelledField('Name');
      const email = labelledField('Email', { type: 'email' });
      const phone = labelledField('Phone');
      const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
      role.append(option('lead', 'Lead carpenter'), option('trade', 'Trade'), option('homeowner', 'Homeowner'));
      const trade = el('select', { 'aria-label': 'Trade' }) as HTMLSelectElement;
      trade.append(option('', 'No trade'));
      for (const key of TRADE_KEYS) trade.append(option(key, TRADE_LABELS[key]));
      const password = labelledField('Initial password', { type: 'text' });
      const problem = el('div', { class: 'formproblem' });
      dialog.body.append(
        problem,
        name.wrap,
        email.wrap,
        phone.wrap,
        el('div', { class: 'field' }, [el('label', {}, ['Role']), role]),
        el('div', { class: 'field' }, [el('label', {}, ['Trade']), trade]),
        password.wrap,
        button('Add', {}, (event) => {
          void (async () => {
            problem.replaceChildren();
            const control = event.currentTarget as HTMLButtonElement;
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
            announce(COPY.saving);
            try {
              await sendJson('POST', `/api/jobs/${ctx.state.jobId}/members`, {
                name: (name.input as HTMLInputElement).value,
                email: (email.input as HTMLInputElement).value,
                phone: (phone.input as HTMLInputElement).value || null,
                role: role.value,
                trade: role.value === 'trade' ? trade.value || null : null,
                initial_password: (password.input as HTMLInputElement).value || null,
              });
              announce('Person added.');
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            } catch (error) {
              const fields = fieldMessages(error);
              const entries: { field: string; message: string; focus: () => void }[] = [];
              for (const [key, field] of [
                ['name', name],
                ['email', email],
                ['phone', phone],
                ['initial_password', password],
              ] as const) {
                const message = fields[key];
                if (message !== undefined) {
                  setFieldError(field.error, field.input, message);
                  entries.push({ field: key, message, focus: () => field.input.focus() });
                }
              }
              if (entries.length === 0) {
                setFieldError(email.error, email.input, messageOf(error));
                entries.push({
                  field: 'email',
                  message: messageOf(error),
                  focus: () => email.input.focus(),
                });
              }
              const summary = errorSummary(entries);
              if (summary !== null) problem.append(summary);
              announce('');
            } finally {
              control.disabled = false;
              control.removeAttribute('aria-busy');
            }
          })();
        }),
      );
    },
    opener,
  );
}

const WEEKDAYS: [string, string][] = [
  ['MO', 'Mon'],
  ['TU', 'Tue'],
  ['WE', 'Wed'],
  ['TH', 'Thu'],
  ['FR', 'Fri'],
  ['SA', 'Sat'],
  ['SU', 'Sun'],
];

function openScheduleVisit(ctx: JobCtx, opener: HTMLButtonElement): void {
  const data = ctx.state.data!;
  openDialog(
    'Schedule visit',
    (dialog) => {
      const person = el('select', { 'aria-label': 'Person' }) as HTMLSelectElement;
      for (const member of data.members.filter((entry) => entry.role === 'trade')) {
        person.append(option(member.id, member.name));
      }
      const starts = labelledField('Starts');
      const ends = labelledField('Ends');
      const repeats = el('select', { 'aria-label': 'Repeats' }) as HTMLSelectElement;
      repeats.append(
        option('none', 'Does not repeat'),
        option('daily', 'Daily'),
        option('weekly', 'Weekly'),
        option('every_n_days', 'Every N days'),
      );
      const weekdayBoxes = WEEKDAYS.map(([code, label]) => {
        const field = labelledField(label, { type: 'checkbox' });
        return { code, field };
      });
      const weekdayWrap = el('div', { class: 'weekdays' }, weekdayBoxes.map((entry) => entry.field.wrap));
      const interval = labelledField('Every how many days', { inputmode: 'numeric' });
      const endsMode = el('select', { 'aria-label': 'Ends' }) as HTMLSelectElement;
      endsMode.append(option('on_date', 'On date'), option('after_count', 'After count'));
      const endDate = labelledField('End date');
      const occurrences = labelledField('Occurrences', { inputmode: 'numeric' });
      const repeatWrap = el('div', { class: 'repeatfields' }, [
        weekdayWrap,
        interval.wrap,
        el('div', { class: 'field' }, [el('label', {}, ['Ends']), endsMode]),
        endDate.wrap,
        occurrences.wrap,
      ]);
      const problem = el('div', { class: 'formproblem' });

      const sync = (): void => {
        const mode = repeats.value;
        weekdayWrap.hidden = mode !== 'weekly';
        interval.wrap.hidden = mode !== 'every_n_days';
        repeatWrap.hidden = mode === 'none';
      };
      repeats.addEventListener('change', sync);

      dialog.body.append(
        problem,
        el('div', { class: 'field' }, [el('label', {}, ['Person']), person]),
        starts.wrap,
        ends.wrap,
        el('div', { class: 'field' }, [el('label', {}, ['Repeats']), repeats]),
        repeatWrap,
        button('Save visit', {}, (event) => {
          void (async () => {
            problem.replaceChildren();
            const mode = repeats.value;
            let recurrence: Record<string, unknown> | null = null;
            if (mode !== 'none') {
              recurrence = { freq: mode };
              if (mode === 'weekly') {
                recurrence.weekdays = weekdayBoxes
                  .filter((entry) => (entry.field.input as HTMLInputElement).checked)
                  .map((entry) => entry.code);
              }
              if (mode === 'every_n_days') {
                recurrence.interval = Number((interval.input as HTMLInputElement).value);
              }
              if (endsMode.value === 'on_date') {
                recurrence.until = (endDate.input as HTMLInputElement).value;
              } else {
                recurrence.count = Number((occurrences.input as HTMLInputElement).value);
              }
            }
            const control = event.currentTarget as HTMLButtonElement;
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
            announce(COPY.saving);
            try {
              await sendJson('POST', `/api/jobs/${ctx.state.jobId}/visits`, {
                member_id: person.value,
                starts_at: (starts.input as HTMLInputElement).value.replace(' ', 'T'),
                ends_at: (ends.input as HTMLInputElement).value.replace(' ', 'T'),
                recurrence,
              });
              announce('Visit scheduled.');
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            } catch (error) {
              showVisitProblem(error, problem, { starts, ends, interval, endDate, occurrences });
            } finally {
              control.disabled = false;
              control.removeAttribute('aria-busy');
            }
          })();
        }),
      );
      sync();
    },
    opener,
  );
}

type VisitFields = {
  starts: ReturnType<typeof labelledField>;
  ends: ReturnType<typeof labelledField>;
  interval?: ReturnType<typeof labelledField>;
  endDate?: ReturnType<typeof labelledField>;
  occurrences?: ReturnType<typeof labelledField>;
};

function showVisitProblem(error: unknown, problem: HTMLElement, fields: VisitFields): void {
  const messages = fieldMessages(error);
  const entries: { field: string; message: string; focus: () => void }[] = [];
  const pairs: [string, ReturnType<typeof labelledField> | undefined][] = [
    ['starts_at', fields.starts],
    ['ends_at', fields.ends],
    ['recurrence', fields.occurrences],
    ['member_id', fields.starts],
  ];
  for (const [key, field] of pairs) {
    const message = messages[key];
    if (message === undefined || field === undefined) continue;
    setFieldError(field.error, field.input, message);
    entries.push({ field: key, message, focus: () => field.input.focus() });
  }
  if (entries.length === 0) {
    setFieldError(fields.starts.error, fields.starts.input, messageOf(error));
    entries.push({
      field: 'starts_at',
      message: messageOf(error),
      focus: () => fields.starts.input.focus(),
    });
  }
  const summary = errorSummary(entries);
  if (summary !== null) problem.append(summary);
  announce('');
}

function openMoveVisit(
  ctx: JobCtx,
  visit: Visit,
  date: string,
  starts: string,
  opener: HTMLButtonElement,
): void {
  openDialog(
    'Move visit',
    (dialog) => {
      const occurrence = visit.occurrences.find((entry) => entry.date === date)!;
      const startField = labelledField('Starts');
      (startField.input as HTMLInputElement).value = localMinutes(occurrence.starts_at);
      const endField = labelledField('Ends');
      (endField.input as HTMLInputElement).value = localMinutes(occurrence.ends_at);
      const problem = el('div', { class: 'formproblem' });
      dialog.body.append(
        problem,
        startField.wrap,
        endField.wrap,
        button('Move visit', {}, (event) => {
          void (async () => {
            problem.replaceChildren();
            const control = event.currentTarget as HTMLButtonElement;
            control.disabled = true;
            control.setAttribute('aria-busy', 'true');
            announce(COPY.saving);
            try {
              await sendJson(
                'PUT',
                `/api/jobs/${ctx.state.jobId}/visits/${visit.id}/occurrences/${date}`,
                {
                  starts_at: (startField.input as HTMLInputElement).value.replace(' ', 'T'),
                  ends_at: (endField.input as HTMLInputElement).value.replace(' ', 'T'),
                },
              );
              announce('Visit moved.');
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            } catch (error) {
              showVisitProblem(error, problem, { starts: startField, ends: endField });
            } finally {
              control.disabled = false;
              control.removeAttribute('aria-busy');
            }
          })();
        }),
      );
      void starts;
    },
    opener,
  );
}

async function cancelOccurrence(
  ctx: JobCtx,
  visit: Visit,
  date: string,
  control: HTMLButtonElement,
): Promise<void> {
  const done = await withPending(
    control,
    () =>
      sendJson('DELETE', `/api/jobs/${ctx.state.jobId}/visits/${visit.id}/occurrences/${date}`, {}),
    () => 'Visit cancelled.',
    (message) => message,
  );
  if (done !== null) await ctx.state.refresh();
  ctx.render();
}

async function deleteSeries(ctx: JobCtx, visit: Visit, control: HTMLButtonElement): Promise<void> {
  const done = await withPending(
    control,
    async () => {
      await remove(`/api/jobs/${ctx.state.jobId}/visits/${visit.id}`);
      return true;
    },
    () => 'Visit cancelled.',
    (message) => message,
  );
  if (done !== null) await ctx.state.refresh();
  ctx.render();
}

/* ---------------------------------------------------------------- costs tab */

export function costsPanel(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  const costs = data.costs;
  const panel = el('div', { class: 'tabpanelbody costs' });
  if (costs === null) return panel;
  const isOwner = data.job.my_role === 'owner';

  panel.append(
    el('div', { class: 'costtables' }, [
      table(
        'Cost by room',
        ['Room', 'Subtotal'],
        costs.by_room.map((entry) => [entry.name, el('span', { class: 'num' }, [money(entry.subtotal)])]),
      ),
      table(
        'Cost by trade',
        ['Trade', 'Subtotal'],
        costs.by_trade.map((entry) => [
          entry.trade === null ? 'Crew' : tradeLabel(entry.trade),
          el('span', { class: 'num' }, [money(entry.subtotal)]),
        ]),
      ),
    ]),
  );

  panel.append(
    el('div', { class: 'totals' }, [
      el('p', { class: 'num' }, [`Subtotal ${money(costs.items_subtotal)}`]),
      el('p', { class: 'num' }, [`Change orders ${money(costs.change_orders_total)}`]),
      el('p', { class: 'num' }, [
        `Contingency ${costs.contingency_percent}% ${money(costs.contingency)}`,
      ]),
      el('p', { class: 'num' }, [`Total ${money(costs.total)}`]),
    ]),
  );

  if (isOwner) {
    const percent = labelledField('Contingency percent', { 'data-fk': 'contingency' });
    (percent.input as HTMLInputElement).value = costs.contingency_percent;
    const save = button('Save contingency', { 'data-fk': 'savecontingency' }, (event) => {
      void (async () => {
        const done = await withPending(
          event.currentTarget as HTMLButtonElement,
          () =>
            sendJson('PUT', `/api/jobs/${ctx.state.jobId}/contingency`, {
              percent: (percent.input as HTMLInputElement).value,
            }),
          () => 'Contingency saved.',
          (message) => message,
        );
        if (done !== null) await ctx.state.refresh();
        ctx.render();
      })();
    });
    save.disabled = offlineNow();
    panel.append(el('div', { class: 'contingency' }, [percent.wrap, save]));
  }

  panel.append(
    table(
      'Change orders',
      ['Description', 'Amount', 'Status', 'Approved at', ''],
      data.changeOrders.map((order: ChangeOrder) => [
        order.description,
        el('span', { class: 'num' }, [money(order.amount)]),
        order.status === 'approved' ? 'Approved' : 'Pending',
        el('span', { class: 'num' }, [
          order.approved_at === null ? '' : jobLocal(order.approved_at, data.job.time_zone),
        ]),
        isOwner && order.status === 'pending' ? approveButton(ctx, order) : '',
      ]),
    ),
  );

  const description = labelledField('Change order description', { 'data-fk': 'codesc' });
  const amount = labelledField('Change order amount', { 'data-fk': 'coamount' });
  const add = button('Add change order', { 'data-fk': 'addco' }, (event) => {
    void (async () => {
      const done = await withPending(
        event.currentTarget as HTMLButtonElement,
        () =>
          sendJson('POST', `/api/jobs/${ctx.state.jobId}/change-orders`, {
            description: (description.input as HTMLInputElement).value,
            amount: (amount.input as HTMLInputElement).value,
          }),
        () => 'Change order added.',
        (message) => message,
      );
      if (done !== null) await ctx.state.refresh();
      ctx.render();
    })();
  });
  add.disabled = offlineNow();
  panel.append(el('div', { class: 'changeorderform' }, [description.wrap, amount.wrap, add]));
  return panel;
}

function approveButton(ctx: JobCtx, order: ChangeOrder): HTMLElement {
  const control = button(`Approve ${order.description}`, { 'data-fk': `approve-${order.id}` }, (event) => {
    void (async () => {
      const done = await withPending(
        event.currentTarget as HTMLButtonElement,
        () =>
          sendJson('POST', `/api/jobs/${ctx.state.jobId}/change-orders/${order.id}/approve`, {}),
        () => 'Change order approved.',
        (message) => message,
      );
      if (done !== null) await ctx.state.refresh();
      ctx.render();
    })();
  });
  control.disabled = offlineNow();
  return control;
}

/* --------------------------------------------------------------- access tab */

export function accessPanel(ctx: JobCtx, codes: HTMLElement): HTMLElement {
  const data = ctx.state.data!;
  const panel = el('div', { class: 'tabpanelbody access' }, [codes]);
  if (data.job.my_role !== 'owner') return panel;

  const card = ctx.ui.codes;
  const lockbox = labelledField('Lockbox code', { 'data-fk': 'lockbox' });
  const alarm = labelledField('Alarm code', { 'data-fk': 'alarm' });
  const garage = labelledField('Garage code', { 'data-fk': 'garage' });
  const note = labelledField('House note', { 'data-fk': 'housenote' });
  (lockbox.input as HTMLInputElement).value = card?.lockbox_code ?? '';
  (alarm.input as HTMLInputElement).value = card?.alarm_code ?? '';
  (garage.input as HTMLInputElement).value = card?.garage_code ?? '';
  (note.input as HTMLInputElement).value = card?.house_note ?? '';
  const save = button('Save access card', { 'data-fk': 'saveaccess' }, (event) => {
    void (async () => {
      const done = await withPending(
        event.currentTarget as HTMLButtonElement,
        () =>
          sendJson('PUT', `/api/jobs/${ctx.state.jobId}/access`, {
            lockbox_code: (lockbox.input as HTMLInputElement).value,
            alarm_code: (alarm.input as HTMLInputElement).value,
            garage_code: (garage.input as HTMLInputElement).value,
            house_note: (note.input as HTMLInputElement).value,
          }),
        () => 'Access card saved.',
        (message) => message,
      );
      if (done !== null) await ctx.state.refresh();
      ctx.render();
    })();
  });
  save.disabled = offlineNow();
  panel.append(
    el('div', { class: 'accessform' }, [lockbox.wrap, alarm.wrap, garage.wrap, note.wrap, save]),
  );
  panel.append(
    table(
      'Code reveals',
      ['Person', 'Role', 'Revealed at'],
      data.reveals.map((reveal) => [
        reveal.name,
        ROLE_LABELS[reveal.role],
        el('span', { class: 'num' }, [jobLocal(reveal.revealed_at, data.job.time_zone)]),
      ]),
    ),
  );
  return panel;
}

/* --------------------------------------------------------------- outbox tab */

export function outboxPanel(ctx: JobCtx): HTMLElement {
  const data = ctx.state.data!;
  return el('div', { class: 'tabpanelbody outbox' }, [
    table(
      'Outbox',
      ['Sent to', 'Subject', 'Status', 'Queued at'],
      data.outbox.map((entry) => [
        entry.to,
        entry.subject,
        entry.status === 'sent' ? COPY.outboxSent : COPY.outboxQueued,
        el('span', { class: 'num' }, [jobLocal(entry.created_at, data.job.time_zone)]),
      ]),
    ),
  ]);
}
