import type { EventDto, RegistrationDto } from '../../shared/api';
import { api, RequestFailed } from '../api';
import { copy, STATUS_LABELS } from '../copy';
import { el, openDialog, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import {
  button,
  formAlert,
  labelledField,
  labelledSelect,
  liveRegion,
  runAction,
} from '../ui';
import { createEventShell, statusLines } from './eventShell';

const WAIVER_TEXT =
  'I accept the risks of motorsport, I will follow every instruction from the course workers and ' +
  'the starter, and I release the club and the venue from claims arising from my taking part in ' +
  'this event. I confirm my car is sound and my helmet meets the club standard.';

const LIFECYCLE: { to: EventDto['status']; label: string }[] = [
  { to: 'registration_open', label: 'Open registration' },
  { to: 'registration_closed', label: 'Close registration' },
  { to: 'running', label: 'Start event' },
  { to: 'provisional', label: 'Post provisional results' },
  { to: 'final', label: 'Set results final' },
];

const NEXT_STATUS: Partial<Record<EventDto['status'], EventDto['status']>> = {
  draft: 'registration_open',
  registration_open: 'registration_closed',
  registration_closed: 'running',
  running: 'provisional',
  provisional: 'final',
};

export function renderEventOverview(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'overview');
  const updates = liveRegion('Event updates');
  const heading = el('h1', { class: 'page-heading' });
  const whereAndWhen = el('p', { class: 'meta' });
  const statusLabel = el('p', { class: 'status-label' });
  const registrationLine = el('p', { class: 'status-line' });
  const protestLine = el('p', { class: 'status-line' });
  const factorPanel = el('div', { class: 'panel' });
  const driverPanel = el('div', { class: 'panel' });
  const chairPanel = el('div', { class: 'panel panel--actions' });

  replace(
    shell.content,
    el(
      'div',
      { class: 'overview' },
      heading,
      whereAndWhen,
      statusLabel,
      registrationLine,
      protestLine,
      updates,
      driverPanel,
      chairPanel,
      factorPanel,
    ),
  );

  let registrations: RegistrationDto[] = [];
  let protestsPending = false;

  async function reload(): Promise<void> {
    const event = await shell.refreshEvent();
    if (!event) return;
    const [registrationResult] = await Promise.all([api.events.registrations(event.id)]);
    registrations = registrationResult.registrations;
    if (event.status === 'provisional') {
      const protests = await api.events.protests(event.id);
      protestsPending = protests.protests.some((protest) => protest.status === 'pending');
    } else {
      protestsPending = false;
    }
    paint(event);
  }

  function myRegistration(): RegistrationDto | null {
    const userId = ctx.user?.id;
    return registrations.find((entry) => entry.driver.id === userId) ?? null;
  }

  function paint(event: EventDto): void {
    const timeZone = event.timeZone;
    heading.textContent = event.name;
    whereAndWhen.textContent = `${event.venue} · ${event.date}`;
    statusLabel.textContent = STATUS_LABELS[event.status];
    const lines = statusLines(event, timeZone);
    registrationLine.textContent = lines.registration;
    protestLine.textContent = lines.protestWindow ?? '';
    protestLine.hidden = lines.protestWindow === null;

    replace(
      factorPanel,
      el('h2', {
        class: 'panel__heading',
        text: `Index table effective ${event.indexTable.effectiveDate}`,
      }),
      el('p', { class: 'meta', text: `${event.venue} · ${event.date}` }),
      el(
        'table',
        { class: 'data-table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', { text: 'Class' }), el('th', { class: 'num', text: 'Factor' })),
        ),
        el(
          'tbody',
          {},
          Object.entries(event.factors).map(([classCode, factor]) =>
            el(
              'tr',
              {},
              el('td', { text: classCode }),
              el('td', { class: 'num mono', text: factor }),
            ),
          ),
        ),
      ),
    );

    paintDriverPanel(event);
    paintChairPanel(event);
  }

  function paintDriverPanel(event: EventDto): void {
    const mine = myRegistration();
    if (mine === null) {
      const alert = formAlert();
      const classes = event.heats.flatMap((heat) => heat.classes);
      const classField = labelledSelect({
        label: 'Class',
        id: 'register-class',
        options: classes.map((code) => ({ value: code, label: code })),
      });
      const numberField = labelledField({
        label: 'Car number',
        id: 'register-number',
        inputMode: 'numeric',
      });
      const descriptionField = labelledField({
        label: 'Car description',
        id: 'register-description',
      });
      const submit = el('button', {
        class: 'button button--primary',
        text: 'Register',
        attrs: { type: 'submit', ...(event.registrationOpen ? {} : { disabled: 'disabled' }) },
      });
      const form = el(
        'form',
        {
          class: 'form',
          attrs: { 'aria-label': 'Register car', novalidate: 'novalidate' },
          on: {
            submit: (submitEvent: SubmitEvent) => {
              submitEvent.preventDefault();
              void register();
            },
          },
        },
        alert.element,
        classField.wrapper,
        numberField.wrapper,
        descriptionField.wrapper,
        submit,
      );
      replace(
        driverPanel,
        el('h2', { class: 'panel__heading', text: 'Your entry' }),
        form,
      );

      async function register(): Promise<void> {
        const carNumber = Number(numberField.input.value.trim());
        const result = await runAction({
          control: submit,
          region: updates,
          pending: copy.register.pending,
          run: () =>
            api.events.register(event.id, {
              classCode: classField.select.value,
              carNumber,
              carDescription: descriptionField.input.value.trim(),
            }),
          success: (created) => {
            const line = copy.register.success(
              created.registration.carNumber,
              created.registration.classCode,
              created.registration.runHeat,
            );
            return created.registration.confirmationEmail === 'pending'
              ? `${line} ${copy.register.emailDelayed}`
              : line;
          },
          failure: (error) => {
            if (error.code === 'registration_closed') return copy.register.closed;
            if (error.code === 'already_registered') return copy.register.already;
            if (error.code === 'car_number_taken') {
              return copy.register.numberTaken(carNumber, classField.select.value);
            }
            if (error.status === 422) {
              alert.fields(
                Object.entries(error.fields).map(([field, message]) => ({
                  message,
                  focus: () => {
                    const map: Record<string, HTMLElement> = {
                      classCode: classField.select,
                      carNumber: numberField.input,
                      carDescription: descriptionField.input,
                    };
                    (map[field] ?? numberField.input).focus();
                  },
                })),
              );
              return Object.values(error.fields)[0] ?? error.message;
            }
            return error.message;
          },
        });
        if (result) await reload();
      }
      return;
    }

    const station = mine.station;
    const withdraw = button('Withdraw', {
      onClick: () => {
        void runAction({
          control: withdraw,
          region: updates,
          pending: copy.withdraw.pending,
          run: () => api.registrations.withdraw(mine.id),
          success: () => copy.withdraw.success(event.name),
          failure: (error) =>
            error.code === 'withdrawal_closed' ? copy.withdraw.closed : error.message,
        }).then(() => reload());
      },
    });
    const checkIn = button('Check in', {
      variant: 'primary',
      onClick: () => openCheckInDialog(mine, checkIn),
    });

    replace(
      driverPanel,
      el('h2', { class: 'panel__heading', text: 'Your entry' }),
      el(
        'dl',
        { class: 'entry-facts' },
        el('dt', { text: 'Car' }),
        el('dd', { class: 'mono', text: `${mine.carNumber} ${mine.classCode}` }),
        el('dt', { text: 'Car description' }),
        el('dd', { text: mine.carDescription }),
        el('dt', { text: 'Run heat' }),
        el('dd', { text: `Heat ${mine.runHeat}` }),
        el('dt', { text: 'Work station' }),
        el('dd', {
          text: station ? `${station.name}, heat ${station.heat}` : 'No station claimed',
        }),
        el('dt', { text: 'Check-in' }),
        el('dd', { text: mine.checkedIn ? 'Checked in' : 'Not checked in' }),
      ),
      el(
        'div',
        { class: 'panel__actions' },
        mine.checkedIn || (event.status !== 'registration_closed' && event.status !== 'running')
          ? null
          : checkIn,
        event.status === 'registration_open' || event.status === 'registration_closed'
          ? withdraw
          : null,
      ),
    );
  }

  function openCheckInDialog(registration: RegistrationDto, opener: HTMLButtonElement): void {
    const alert = formAlert();
    const signature = labelledField({
      label: 'Type your full name to sign',
      id: 'checkin-signature',
    });
    openDialog({
      name: 'Check in and sign waiver',
      heading: 'Check in and sign waiver',
      build: (close) => {
        const sign = button('Sign and check in', {
          variant: 'primary',
          onClick: () => {
            void (async () => {
              const result = await runAction({
                control: sign,
                region: updates,
                pending: copy.checkIn.pending,
                run: () => api.registrations.checkIn(registration.id, signature.input.value),
                success: () => copy.checkIn.success,
                failure: (error) => {
                  if (error.code === 'renderer_unavailable') return copy.checkIn.renderer;
                  if (error.code === 'storage_unavailable') return copy.checkIn.storage;
                  if (error.status === 422) {
                    alert.fields([
                      { message: copy.checkIn.mismatch, focus: () => signature.input.focus() },
                    ]);
                    return copy.checkIn.mismatch;
                  }
                  return error.message;
                },
              });
              if (result) {
                close();
                await reload();
              }
            })();
          },
        });
        return [
          alert.element,
          el('p', { class: 'waiver-text', text: WAIVER_TEXT }),
          signature.wrapper,
          el('div', { class: 'dialog__actions' }, sign, button('Cancel', { onClick: close })),
        ];
      },
      onClose: () => opener.focus(),
    });
  }

  function paintChairPanel(event: EventDto): void {
    if (!(ctx.user?.roles.includes('chair') ?? false)) {
      replace(chairPanel);
      chairPanel.hidden = true;
      return;
    }
    chairPanel.hidden = false;
    const next = NEXT_STATUS[event.status];
    const entry = LIFECYCLE.find((candidate) => candidate.to === next);
    if (!entry) {
      replace(chairPanel, el('h2', { class: 'panel__heading', text: 'Event controls' }));
      return;
    }
    const blocked =
      entry.to === 'final' && (event.protestWindowOpen || protestsPending);
    const control = button(entry.label, {
      variant: 'primary',
      disabled: blocked,
      onClick: () => {
        void runAction({
          control,
          region: updates,
          pending: copy.event.lifecyclePending,
          run: () => api.events.transition(event.id, entry.to),
          success: (result) => copy.event.lifecycleDone(result.event.status),
          failure: (error) => {
            if (error.code === 'illegal_transition') return copy.event.illegal(event.status);
            if (error.code === 'protest_window_open') return copy.event.windowOpen;
            if (error.code === 'protests_pending') return copy.event.protestsPending;
            return error.message;
          },
        }).then(() => reload());
      },
    });
    replace(
      chairPanel,
      el('h2', { class: 'panel__heading', text: 'Event controls' }),
      el('div', { class: 'panel__actions' }, control),
    );
  }

  const timer = window.setInterval(() => {
    void reload();
  }, 10_000);
  const onFocus = (): void => {
    void reload();
  };
  window.addEventListener('focus', onFocus);
  void reload();

  return {
    element: shell.element,
    destroy: () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      shell.destroy();
    },
  };
}

