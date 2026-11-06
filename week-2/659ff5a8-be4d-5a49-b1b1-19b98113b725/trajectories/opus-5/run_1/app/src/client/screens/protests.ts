import type { CorrectionDto, ProtestDto, RegistrationDto } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, openDialog, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, labelledSelect, labelledTextarea, liveRegion, runAction } from '../ui';
import { createEventShell, statusLines } from './eventShell';
import { correctionValueText, correctionTime } from './corrections';

export function renderProtests(ctx: ScreenContext): ScreenHandle {
  const shell = createEventShell(ctx, 'protests');
  const updates = liveRegion('Protest updates');
  const list = el('div', { class: 'protest-list' });
  const fileButton = button('File a protest', {
    variant: 'primary',
    disabled: true,
    onClick: () => openFileDialog(),
  });
  const windowLine = el('p', { class: 'status-line' });

  replace(
    shell.content,
    el(
      'div',
      { class: 'protests' },
      el('h1', { class: 'page-heading', text: 'Protests' }),
      windowLine,
      fileButton,
      updates,
      list,
    ),
  );

  let registrations: RegistrationDto[] = [];
  let protests: ProtestDto[] = [];
  let corrections: CorrectionDto[] = [];
  const isChair = ctx.user?.roles.includes('chair') ?? false;

  function openFileDialog(): void {
    const ordered = [...registrations].sort((a, b) => {
      const byClass = a.classCode.localeCompare(b.classCode);
      return byClass !== 0 ? byClass : a.carNumber - b.carNumber;
    });
    const picker = labelledSelect({
      label: 'Car protested',
      id: 'protest-car',
      options: ordered.map((entry) => ({
        value: entry.id,
        label: `Car ${entry.carNumber} ${entry.classCode}, ${entry.driver.name}`,
      })),
    });
    const details = labelledTextarea({ label: 'Protest details', id: 'protest-details', rows: 4 });
    openDialog({
      name: 'File a protest',
      heading: 'File a protest',
      build: (close) => {
        const submit = button('File protest', {
          variant: 'primary',
          onClick: () => {
            const subject = ordered.find((entry) => entry.id === picker.select.value);
            void runAction({
              control: submit,
              region: updates,
              pending: copy.protest.filePending,
              run: () =>
                api.events.fileProtest(shell.eventId, {
                  registrationId: picker.select.value,
                  text: details.textarea.value.trim(),
                }),
              success: () =>
                copy.protest.filed(subject?.carNumber ?? 0, subject?.classCode ?? ''),
              failure: (error) =>
                error.code === 'protest_window_closed' ? copy.protest.closed : error.message,
            }).then(async (result) => {
              if (result) close();
              await reload();
            });
          },
        });
        return [
          picker.wrapper,
          details.wrapper,
          el('div', { class: 'dialog__actions' }, submit, button('Cancel', { onClick: close })),
        ];
      },
    });
  }

  function correctionItems(registrationId: string, timeZone: string): HTMLElement[] {
    return corrections
      .filter((correction) => correction.registrationId === registrationId)
      .map((correction) =>
        el('li', {
          class: 'correction-item',
          text: `Run ${correction.runNumber}: ${correctionValueText(
            correction.before,
          )} to ${correctionValueText(correction.after)} by ${correction.actor.name} at ${
            correctionTime(correction.at, timeZone).time
          }, reason: ${correction.reason}`,
        }),
      );
  }

  function paint(): void {
    const event = shell.current();
    const timeZone = event?.timeZone ?? 'UTC';
    if (event) {
      windowLine.textContent = statusLines(event, timeZone).protestWindow ?? copy.protestWindowClosed;
      fileButton.disabled = !event.protestWindowOpen;
    }

    replace(
      list,
      protests.length === 0
        ? el('p', { class: 'empty', text: 'No protests filed.' })
        : el(
            'ul',
            { class: 'protest-list__items' },
            protests.map((protest) => protestItem(protest, timeZone)),
          ),
    );
  }

  function protestItem(protest: ProtestDto, timeZone: string): HTMLElement {
    const facts = el(
      'div',
      { class: 'protest-item__facts' },
      el('p', {
        class: 'protest-item__subject',
        text: `Car ${protest.subject.carNumber} ${protest.subject.classCode}, ${protest.subject.driverName}`,
      }),
      el('p', { class: 'protest-item__text', text: protest.text }),
      el('p', {
        class: 'protest-item__status',
        text: `Filed by ${protest.filedBy.name} · ${protest.status}${
          protest.decisionNote ? ` · ${protest.decisionNote}` : ''
        }`,
      }),
    );

    if (!isChair || protest.status !== 'pending') {
      return el('li', { class: 'protest-item' }, facts);
    }

    const note = labelledTextarea({
      label: 'Decision note',
      id: `decision-${protest.id}`,
      rows: 2,
    });
    const decide = (decision: 'upheld' | 'denied', control: HTMLButtonElement): void => {
      void runAction({
        control,
        region: updates,
        pending: copy.protest.decidePending,
        run: () => api.protests.decide(protest.id, { decision, note: note.textarea.value.trim() }),
        success: () => (decision === 'upheld' ? copy.protest.upheld : copy.protest.denied),
        failure: (error) => error.message,
      }).then(() => reload());
    };
    const uphold = button('Uphold', { onClick: () => decide('upheld', uphold) });
    const deny = button('Deny', { onClick: () => decide('denied', deny) });

    return el(
      'li',
      { class: 'protest-item' },
      el(
        'section',
        {
          class: 'protest-item__region',
          attrs: {
            role: 'region',
            'aria-label': `Protest against car ${protest.subject.carNumber} ${protest.subject.classCode}`,
          },
        },
        facts,
        el(
          'ul',
          {
            class: 'correction-list',
            attrs: {
              'aria-label': `Corrections for car ${protest.subject.carNumber} ${protest.subject.classCode}`,
            },
          },
          correctionItems(protest.subject.registrationId, timeZone),
        ),
        note.wrapper,
        el('div', { class: 'panel__actions' }, uphold, deny),
      ),
    );
  }

  async function reload(): Promise<void> {
    await shell.refreshEvent();
    const [protestResult, registrationResult, correctionResult] = await Promise.all([
      api.events.protests(shell.eventId),
      api.events.registrations(shell.eventId),
      api.events.corrections(shell.eventId),
    ]);
    protests = protestResult.protests;
    registrations = registrationResult.registrations;
    corrections = correctionResult.corrections;
    paint();
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
