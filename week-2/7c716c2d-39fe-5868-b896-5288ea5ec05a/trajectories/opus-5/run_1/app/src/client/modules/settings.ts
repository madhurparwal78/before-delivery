import { api, ApiCallError } from '../api.js';
import { copy } from '../copy.js';
import { clear, el, setText } from '../dom.js';
import { dateOfInstant, formatDate } from '../format.js';
import { type Route } from '../router.js';
import { announce, notFoundSheet, titleBlock, type ModuleContext, type ModuleHandle } from '../shell.js';
import { state, subscribe } from '../store.js';
import type { Billing, Holiday, Invite, Person, Workspace } from '../../shared/types.js';

type Draft = {
  timeZone: string;
  weekdays: Set<number>;
  holidays: Holiday[];
  anchor: string;
};

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function settingsModule(context: ModuleContext): ModuleHandle {
  let draft: Draft | null = null;
  let loadedStamp = '';
  let fieldErrors: Record<string, string> = {};
  let seatsTyped: string | null = null;
  let seatPending = false;
  let billingMessage = '';
  let billing: Billing | null = null;
  let invites: Invite[] = [];

  const errorRegion = el('div', { class: 'calendar-errors', role: 'region', 'aria-label': 'Calendar errors' });
  const calendarForm = el('form', { class: 'sheet-form', 'aria-label': 'Working calendar' });
  const seatsSection = el('section', { class: 'settings-section seats' });
  const peopleSection = el('section', { class: 'settings-section people' });
  const passwordSection = el('section', { class: 'settings-section password' });

  const sheet = el('div', { class: 'sheet settings-sheet' }, [
    titleBlock('Settings', 'Workspace', ''),
    el('h1', { class: 'display', 'data-detail-title': 'true', text: 'Settings' }),
    errorRegion,
    calendarForm,
    seatsSection,
    peopleSection,
    passwordSection,
  ]);
  context.detail.append(sheet);

  const listRows = el('div', { class: 'rows settings-list' });
  for (const section of [
    { label: 'Working calendar', target: calendarForm },
    { label: 'Seats and billing', target: seatsSection },
    { label: 'People', target: peopleSection },
    { label: 'Password', target: passwordSection },
  ]) {
    const row = el('button', { type: 'button', class: 'row settings-row', text: section.label });
    row.addEventListener('click', () => {
      context.openDetail(row);
      section.target.scrollIntoView({ block: 'start' });
    });
    listRows.append(row);
  }
  context.list.append(listRows);

  function stampOf(workspace: Workspace): string {
    return JSON.stringify([
      workspace.time_zone,
      [...workspace.working_weekdays].sort((left, right) => left - right),
      workspace.holidays,
      workspace.cycle_anchor,
    ]);
  }

  function draftStamp(current: Draft): string {
    return JSON.stringify([
      current.timeZone,
      [...current.weekdays].sort((left, right) => left - right),
      current.holidays,
      current.anchor,
    ]);
  }

  function draftFrom(workspace: Workspace): Draft {
    return {
      timeZone: workspace.time_zone,
      weekdays: new Set(workspace.working_weekdays),
      holidays: workspace.holidays.map((holiday) => ({ ...holiday })),
      anchor: workspace.cycle_anchor,
    };
  }

  function renderCalendar(): void {
    const workspace = state.workspace;
    if (workspace === null) return;
    if (draft === null) {
      draft = draftFrom(workspace);
      loadedStamp = stampOf(workspace);
    }
    const current = draft;
    clear(calendarForm);

    const zoneInput = el('input', { type: 'text', class: 'mono', id: 'time-zone', list: 'zone-list' });
    zoneInput.setAttribute('aria-label', 'Time zone');
    zoneInput.value = current.timeZone;
    zoneInput.addEventListener('input', () => {
      current.timeZone = zoneInput.value;
      clearFieldError('time_zone');
    });
    const zoneList = el('datalist', { id: 'zone-list' });
    for (const zone of zoneNames()) zoneList.append(el('option', { value: zone }));
    markInvalid(zoneInput, 'time_zone');

    const weekdayBoxes = el('div', { class: 'weekdays' });
    weekdayNames.forEach((name, index) => {
      const iso = index + 1;
      const box = el('input', { type: 'checkbox', id: `weekday-${iso}` });
      box.checked = current.weekdays.has(iso);
      box.addEventListener('change', () => {
        if (box.checked) current.weekdays.add(iso);
        else current.weekdays.delete(iso);
        clearFieldError('working_weekdays');
      });
      if (iso === 1) markInvalid(box, 'working_weekdays');
      weekdayBoxes.append(el('label', { class: 'weekday', for: `weekday-${iso}` }, [box, el('span', { text: name })]));
    });

    const holidayDate = el('input', { type: 'text', class: 'mono', id: 'holiday-date' });
    holidayDate.setAttribute('aria-label', 'Holiday date');
    const holidayName = el('input', { type: 'text', id: 'holiday-name' });
    holidayName.setAttribute('aria-label', 'Holiday name');
    holidayDate.addEventListener('input', () => clearFieldError('holidays'));
    holidayName.addEventListener('input', () => clearFieldError('holidays'));
    markInvalid(holidayDate, 'holidays');
    const addHoliday = el('button', { type: 'button', text: 'Add holiday' });
    addHoliday.addEventListener('click', () => {
      current.holidays = [...current.holidays, { date: holidayDate.value, name: holidayName.value }];
      holidayDate.value = '';
      holidayName.value = '';
      renderCalendar();
    });

    const holidayList = el('ul', { class: 'holidays' });
    for (const holiday of current.holidays) {
      const remove = el('button', { type: 'button', text: `Remove holiday ${holiday.date}` });
      remove.addEventListener('click', () => {
        current.holidays = current.holidays.filter((entry) => entry.date !== holiday.date);
        renderCalendar();
      });
      holidayList.append(
        el('li', {}, [
          el('span', { class: 'mono', text: holiday.date }),
          el('span', { text: holiday.name }),
          remove,
        ]),
      );
    }

    const anchor = el('input', { type: 'text', class: 'mono', id: 'first-cycle' });
    anchor.setAttribute('aria-label', 'First cycle starts');
    anchor.value = current.anchor;
    anchor.addEventListener('input', () => {
      current.anchor = anchor.value;
      clearFieldError('cycle_anchor');
    });
    markInvalid(anchor, 'cycle_anchor');

    const save = el('button', { type: 'submit', text: 'Save calendar' });
    const digest = el('p', {
      class: 'mono next-digest',
      text: copy.nextDigest(formatDate(dateOfInstant(workspace.next_digest_at))),
    });
    const today = el('p', { class: 'mono today-line', text: copy.todayLine(formatDate(workspace.today)) });

    calendarForm.append(
      el('h2', { class: 'display', text: 'Working calendar' }),
      today,
      digest,
      el('label', { for: 'time-zone', text: 'Time zone' }),
      zoneInput,
      zoneList,
      fieldErrorNode('time_zone'),
      el('fieldset', {}, [el('legend', { text: 'Working days' }), weekdayBoxes]),
      fieldErrorNode('working_weekdays'),
      el('fieldset', {}, [
        el('legend', { text: 'Holidays' }),
        el('label', { for: 'holiday-date', text: 'Holiday date' }),
        holidayDate,
        el('label', { for: 'holiday-name', text: 'Holiday name' }),
        holidayName,
        addHoliday,
        holidayList,
      ]),
      fieldErrorNode('holidays'),
      el('label', { for: 'first-cycle', text: 'First cycle starts' }),
      anchor,
      fieldErrorNode('cycle_anchor'),
      save,
    );
    calendarForm.onsubmit = (event) => {
      event.preventDefault();
      void saveCalendar();
    };
  }

  function fieldErrorNode(field: string): HTMLElement {
    const message = fieldErrors[field];
    return el('p', {
      class: 'field-error',
      id: `calendar-error-${field}`,
      text: message ?? '',
    });
  }

  function markInvalid(node: HTMLElement, field: string): void {
    if (fieldErrors[field] === undefined) {
      node.removeAttribute('aria-invalid');
      node.removeAttribute('aria-describedby');
      return;
    }
    node.setAttribute('aria-invalid', 'true');
    node.setAttribute('aria-describedby', `calendar-error-${field}`);
  }

  function clearFieldError(field: string): void {
    if (fieldErrors[field] === undefined) return;
    const { [field]: _dropped, ...rest } = fieldErrors;
    fieldErrors = rest;
    renderErrorSummary();
    renderCalendar();
  }

  function renderErrorSummary(): void {
    clear(errorRegion);
    const order = ['time_zone', 'working_weekdays', 'holidays', 'cycle_anchor'];
    const targets: Record<string, string> = {
      time_zone: 'time-zone',
      working_weekdays: 'weekday-1',
      holidays: 'holiday-date',
      cycle_anchor: 'first-cycle',
    };
    const entries = order.filter((field) => fieldErrors[field] !== undefined);
    if (entries.length === 0) return;
    const list = el('ul', { class: 'error-list' });
    for (const field of entries) {
      const link = el('a', { href: `#${targets[field] ?? ''}`, text: fieldErrors[field] ?? '' });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById(targets[field] ?? '')?.focus();
      });
      list.append(el('li', {}, [link]));
    }
    errorRegion.append(list);
  }

  async function saveCalendar(): Promise<void> {
    const current = draft;
    if (current === null) return;
    announce(copy.savingCalendar);
    try {
      const workspace = await api<Workspace>('PUT', '/api/workspace/calendar', {
        body: {
          time_zone: current.timeZone,
          working_weekdays: [...current.weekdays].sort((left, right) => left - right),
          holidays: current.holidays,
          cycle_anchor: current.anchor,
        },
      });
      fieldErrors = {};
      draft = draftFrom(workspace);
      loadedStamp = stampOf(workspace);
      renderErrorSummary();
      renderCalendar();
      announce(copy.calendarSaved);
    } catch (error) {
      if (!(error instanceof ApiCallError)) return;
      if (error.code === 'validation') {
        fieldErrors = error.fields;
        renderErrorSummary();
        renderCalendar();
        announce(copy.calendarProblems(Object.keys(error.fields).length));
      }
    }
  }

  function renderSeats(): void {
    clear(seatsSection);
    const workspace = state.workspace;
    const limit = billing?.limit ?? workspace?.seats?.limit ?? 0;
    const active = billing?.active ?? workspace?.seats?.active ?? 0;
    const pendingSeats = billing?.pending ?? workspace?.seats?.pending ?? 0;
    const total = billing?.monthly_total ?? (limit * 8).toFixed(2);
    const seats = el('input', { type: 'number', min: '1', max: '40', class: 'mono', id: 'seats' });
    seats.setAttribute('aria-label', 'Seats');
    seats.value = seatsTyped ?? String(limit);
    seats.addEventListener('input', () => {
      seatsTyped = seats.value;
    });
    const updateSeats = el('button', { type: 'button', text: 'Update seats' });
    updateSeats.setAttribute('aria-disabled', seatPending ? 'true' : 'false');
    updateSeats.addEventListener('click', () => {
      if (seatPending) return;
      void changeSeats(Number(seats.value));
    });
    const status = el('p', {
      class: 'billing-status',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Billing status',
      text: billingMessage !== '' ? billingMessage : scheduledCopy(),
    });
    seatsSection.append(
      el('h2', { class: 'display', text: 'Seats and billing' }),
      el('p', { class: 'mono', text: copy.seatsUsed(active, limit, pendingSeats) }),
      el('p', { class: 'mono', text: copy.monthlyTotal(total) }),
      el('label', { for: 'seats', text: 'Seats' }),
      seats,
      updateSeats,
      status,
    );
  }

  function scheduledCopy(): string {
    if (billing === null || billing.scheduled_limit === null || billing.scheduled_on === null) return '';
    return copy.seatReductionScheduled(billing.limit, formatDate(billing.scheduled_on), billing.scheduled_limit);
  }

  async function changeSeats(seats: number): Promise<void> {
    seatPending = true;
    billingMessage = copy.confirmingWithBilling;
    renderSeats();
    try {
      const result = await api<Billing>('PUT', '/api/billing/seats', { body: { seats } });
      billing = result;
      if (result.scheduled_limit !== null && result.scheduled_on !== null) {
        billingMessage = copy.seatReductionScheduled(
          result.limit,
          formatDate(result.scheduled_on),
          result.scheduled_limit,
        );
      } else {
        billingMessage = copy.seatLimitNow(result.limit);
      }
      seatsTyped = null;
    } catch (error) {
      if (error instanceof ApiCallError && error.code === 'seats_below_active') {
        billingMessage = copy.seatsBelowActive(billing?.active ?? state.workspace?.seats?.active ?? 0);
      } else if (error instanceof ApiCallError && error.code === 'validation') {
        billingMessage = copy.seatsRange;
      } else if (error instanceof ApiCallError && error.code === 'billing_unavailable') {
        billingMessage = copy.seatsNotChanged(billing?.limit ?? state.workspace?.seats?.limit ?? 0);
      } else {
        billingMessage = copy.seatsNotChanged(billing?.limit ?? 0);
      }
    } finally {
      seatPending = false;
      renderSeats();
      void loadBilling();
    }
  }

  async function loadBilling(): Promise<void> {
    const result = await api<Billing>('GET', '/api/billing').catch(() => null);
    if (result === null) return;
    billing = result;
    renderSeats();
  }

  function renderPeople(): void {
    clear(peopleSection);
    const members = el('table', { class: 'members' });
    members.setAttribute('aria-label', 'Members');
    const body = el('tbody');
    for (const person of state.members) {
      const row = el('tr', {}, [
        el('td', { text: person.name }),
        el('td', { class: 'mono', text: person.email }),
        el('td', { text: person.role ?? '' }),
      ]);
      const cell = el('td');
      if (person.role !== 'owner') {
        const remove = el('button', { type: 'button', text: `Remove ${person.name}` });
        remove.addEventListener('click', () => {
          void api('DELETE', `/api/members/${person.id}`)
            .then(() => {
              announce(copy.personRemoved(person.name));
              void refreshPeople();
            })
            .catch(() => undefined);
        });
        cell.append(remove);
      }
      row.append(cell);
      body.append(row);
    }
    members.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Name' }),
          el('th', { text: 'Email' }),
          el('th', { text: 'Role' }),
          el('th', { text: 'Remove' }),
        ]),
      ]),
      body,
    );

    const inviteForm = el('form', { class: 'sheet-form invite-form', 'aria-label': 'Invite' });
    const email = el('input', { type: 'email', id: 'invite-email', class: 'mono' });
    email.setAttribute('aria-label', 'Invite email');
    const memberRadio = el('input', { type: 'radio', name: 'invite-role', id: 'invite-member' });
    memberRadio.checked = true;
    const guestRadio = el('input', { type: 'radio', name: 'invite-role', id: 'invite-guest' });
    const scopes = el('div', { class: 'invite-scopes' });
    const projectBoxes = new Map<string, HTMLInputElement>();
    const channelBoxes = new Map<string, HTMLInputElement>();
    for (const project of state.projects) {
      const box = el('input', { type: 'checkbox', id: `invite-project-${project.id}` });
      projectBoxes.set(project.id, box);
      scopes.append(
        el('label', { for: `invite-project-${project.id}` }, [box, el('span', { text: project.name })]),
      );
    }
    for (const channel of state.channels) {
      const box = el('input', { type: 'checkbox', id: `invite-channel-${channel.id}` });
      channelBoxes.set(channel.id, box);
      scopes.append(
        el('label', { for: `invite-channel-${channel.id}` }, [box, el('span', { text: `#${channel.name}` })]),
      );
    }
    const applyScopes = (): void => {
      scopes.hidden = !guestRadio.checked;
    };
    memberRadio.addEventListener('change', applyScopes);
    guestRadio.addEventListener('change', applyScopes);
    applyScopes();
    const sendInvite = el('button', { type: 'submit', text: 'Send invite' });
    inviteForm.append(
      el('h3', { text: 'Invite' }),
      el('label', { for: 'invite-email', text: 'Invite email' }),
      email,
      el('label', { for: 'invite-member' }, [memberRadio, el('span', { text: 'Member' })]),
      el('label', { for: 'invite-guest' }, [guestRadio, el('span', { text: 'Guest' })]),
      scopes,
      sendInvite,
    );
    inviteForm.onsubmit = (event) => {
      event.preventDefault();
      const role = guestRadio.checked ? 'guest' : 'member';
      const address = email.value;
      void api<Invite>('POST', '/api/invites', {
        body: {
          email: address,
          role,
          project_ids:
            role === 'guest'
              ? [...projectBoxes.entries()].filter(([, box]) => box.checked).map(([id]) => id)
              : [],
          channel_ids:
            role === 'guest'
              ? [...channelBoxes.entries()].filter(([, box]) => box.checked).map(([id]) => id)
              : [],
        },
      })
        .then(() => {
          announce(copy.inviteCreated(address));
          email.value = '';
          void refreshInvites();
        })
        .catch((error: unknown) => {
          if (!(error instanceof ApiCallError)) return;
          if (error.code === 'workspace_full') announce(copy.inviteNoSeats);
          else if (error.code === 'invite_pending') announce(copy.invitePending(address));
          else if (error.code === 'already_member') announce(copy.inviteAlreadyMember(address));
          else if (error.code === 'billing_unavailable') announce(copy.inviteBillingDown);
        });
    };

    const inviteTable = el('table', { class: 'invites' });
    inviteTable.setAttribute('aria-label', 'Invites');
    const inviteBody = el('tbody');
    for (const invite of invites) {
      const row = el('tr', {}, [
        el('td', { class: 'mono', text: invite.email }),
        el('td', { text: invite.role }),
        el('td', { text: invite.status }),
      ]);
      const cell = el('td');
      if (invite.status === 'pending') {
        const revoke = el('button', { type: 'button', text: `Revoke invite for ${invite.email}` });
        revoke.addEventListener('click', () => {
          void api('DELETE', `/api/invites/${invite.id}`)
            .then(() => {
              announce(copy.inviteRevoked(invite.email));
              void refreshInvites();
            })
            .catch(() => undefined);
        });
        cell.append(revoke);
      }
      row.append(cell);
      inviteBody.append(row);
    }
    inviteTable.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Email' }),
          el('th', { text: 'Role' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'Revoke' }),
        ]),
      ]),
      inviteBody,
    );

    peopleSection.append(el('h2', { class: 'display', text: 'People' }), members, inviteForm, inviteTable);
  }

  async function refreshPeople(): Promise<void> {
    const result = await api<{ members: Person[] }>('GET', '/api/members').catch(() => null);
    if (result !== null) {
      state.members = result.members;
      renderPeople();
    }
    void loadBilling();
  }

  async function refreshInvites(): Promise<void> {
    const result = await api<{ invites: Invite[] }>('GET', '/api/invites').catch(() => null);
    if (result === null) return;
    invites = result.invites;
    renderPeople();
    void loadBilling();
  }

  function renderPassword(): void {
    clear(passwordSection);
    passwordSection.append(passwordForm());
  }

  const unsubscribe = subscribe((keys) => {
    if (keys.has('workspace')) {
      const workspace = state.workspace;
      if (workspace !== null) {
        const stamp = stampOf(workspace);
        const unsaved = draft !== null && draftStamp(draft) !== loadedStamp;
        if (!unsaved && stamp !== loadedStamp) {
          draft = draftFrom(workspace);
          loadedStamp = stamp;
          renderCalendar();
        } else {
          const digest = calendarForm.querySelector('.next-digest');
          if (digest !== null) {
            setText(digest, copy.nextDigest(formatDate(dateOfInstant(workspace.next_digest_at))));
          }
          const today = calendarForm.querySelector('.today-line');
          if (today !== null) setText(today, copy.todayLine(formatDate(workspace.today)));
        }
      }
    }
    if (keys.has('members')) renderPeople();
  });

  return {
    id: 'settings',
    firstPane: 'detail',
    route(route: Route) {
      if (!context.detail.contains(sheet)) {
        clear(context.detail);
        context.detail.append(sheet);
      }
      if (route.segments.length > 1) {
        clear(context.detail);
        context.detail.append(notFoundSheet());
        return;
      }
      renderCalendar();
      renderErrorSummary();
      renderSeats();
      renderPeople();
      renderPassword();
      void loadBilling();
      void refreshInvites();
    },
    destroy() {
      unsubscribe();
      clear(context.list);
      clear(context.detail);
    },
  };
}

export function passwordForm(): HTMLElement {
  const current = el('input', { type: 'password', id: 'current-password', autocomplete: 'current-password' });
  current.setAttribute('aria-label', 'Current password');
  const next = el('input', { type: 'password', id: 'new-password', autocomplete: 'new-password' });
  next.setAttribute('aria-label', 'New password');
  const form = el('form', { class: 'sheet-form', 'aria-label': 'Password' }, [
    el('h2', { class: 'display', text: 'Password' }),
    el('label', { for: 'current-password', text: 'Current password' }),
    current,
    el('label', { for: 'new-password', text: 'New password' }),
    next,
    el('button', { type: 'submit', text: 'Change password' }),
  ]);
  form.onsubmit = (event) => {
    event.preventDefault();
    announce(copy.changingPassword);
    void api('POST', '/api/account/password', {
      body: { current_password: current.value, new_password: next.value },
    })
      .then(() => {
        current.value = '';
        next.value = '';
        announce(copy.passwordChanged);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiCallError)) return;
        if (error.code === 'invalid_credentials') announce(copy.wrongCurrentPassword);
        else if (error.code === 'validation') announce(copy.passwordLength);
      });
  };
  return form;
}

function zoneNames(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  if (typeof supported === 'function') return supported('timeZone');
  return ['UTC', 'Pacific/Auckland', 'America/New_York', 'Europe/London', 'Africa/Cairo', 'America/Havana'];
}
