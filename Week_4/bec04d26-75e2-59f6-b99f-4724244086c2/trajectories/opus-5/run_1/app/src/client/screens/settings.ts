import type { App } from '../app';
import { el } from '../dom';

function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:00 ${suffix}`;
}

export function renderSettings(app: App): HTMLElement {
  const me = app.state.me;
  const current = app.state.formFields.reminder_hour ?? String(me?.reminder_hour ?? 9);
  const message = app.state.formErrors.reminder_hour;
  const options: HTMLElement[] = [];
  for (let hour = 6; hour <= 21; hour += 1) {
    options.push(
      el('option', { value: String(hour), selected: String(hour) === current }, hourLabel(hour)),
    );
  }
  const submit = (): void => {
    void app.saveReminderHour();
  };

  return el(
    'main',
    { class: 'screen form-column' },
    el('h1', {}, 'Settings'),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'reminder-hour' }, 'Reminder hour'),
      el(
        'select',
        {
          id: 'reminder-hour',
          'data-focus-key': 'form:reminder_hour',
          'aria-invalid': message ? 'true' : null,
          'aria-describedby': message ? 'reminder-hour-error' : null,
          onChange: (event: Event) => {
            app.state.formFields.reminder_hour = (event.target as HTMLSelectElement).value;
          },
          onKeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          },
        },
        ...options,
      ),
      el(
        'span',
        { class: 'hint' },
        'Reminders go out at this hour in Central time, 7 days and 1 day before each deadline.',
      ),
      message
        ? el(
            'span',
            { class: 'field-error', id: 'reminder-hour-error', 'data-field-error': 'reminder_hour' },
            message,
          )
        : null,
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'primary',
        'data-focus-key': 'save-reminder-hour',
        onClick: submit,
      },
      app.isBusy('reminder-hour') ? 'Saving' : 'Save reminder hour',
    ),
  );
}
