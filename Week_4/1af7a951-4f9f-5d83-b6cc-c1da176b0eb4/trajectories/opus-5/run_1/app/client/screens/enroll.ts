import { api } from '../api.js';
import { COPY } from '../copy.js';
import { h, setText } from '../dom.js';
import { statusRegion } from '../live.js';
import { navigate } from '../main.js';

function field(labelText: string, control: HTMLElement): HTMLElement {
  const id = `field-${labelText.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  control.id = id;
  const message = h('p', { class: 'field-error', id: `${id}-error` });
  control.setAttribute('aria-describedby', `${id}-error`);
  return h('div', { class: 'field' }, [
    h('label', { for: id, text: labelText }),
    control,
    message,
  ]);
}

function errorNodeFor(form: HTMLElement, controlId: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`#${controlId}-error`);
}

export function enrollScreen(cohortId: string): Node {
  const screen = h('section', { class: 'screen narrow' });
  void (async () => {
    const result = await api.cohort(cohortId);
    if (!result.ok || result.body === null) {
      screen.append(
        h('h1', { text: 'Cohort not found' }),
        h('p', { text: COPY.cohortNotFound }),
      );
      return;
    }
    const cohort = result.body.cohort;
    const name = h('input', { type: 'text', 'aria-label': 'Your name', name: 'name' });
    const email = h('input', { type: 'email', 'aria-label': 'Email', name: 'email' });
    const zone = h('select', { 'aria-label': 'Home time zone', name: 'home_tz' });
    const bedtime = h('input', {
      type: 'text',
      'aria-label': 'Usual bedtime',
      name: 'bedtime',
      value: '23:00',
      placeholder: 'HH:MM',
    });
    const submit = h('button', { type: 'submit', class: 'primary', text: COPY.continueToPayment });
    const status = statusRegion('Enrollment');

    const form = h('form', { 'aria-label': `Enroll in ${cohort.name}`, class: 'stack' }, [
      h('h1', { text: cohort.name }),
      field('Your name', name),
      field('Email', email),
      field('Home time zone', zone),
      field('Usual bedtime', bedtime),
      submit,
      status,
    ]);
    screen.append(form);

    const zones = await api.timeZones();
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const value of zones.body?.zones ?? []) {
      zone.append(h('option', { value, text: value }));
    }
    zone.value = (zones.body?.zones ?? []).includes(browserZone) ? browserZone : 'UTC';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        submit.disabled = true;
        for (const node of form.querySelectorAll('.field-error')) node.textContent = '';
        const result = await api.createEnrollment({
          cohort_id: cohort.id,
          name: name.value,
          email: email.value,
          home_tz: zone.value,
          bedtime: bedtime.value,
        });
        submit.disabled = false;
        if (result.ok && result.body !== null) {
          sessionStorage.setItem('lf.access_code', result.body.access_code);
          navigate(`/enrollments/${result.body.enrollment.id}`);
          return;
        }
        if (result.fieldErrors !== null) {
          const controls: Record<string, HTMLElement> = {
            name,
            email,
            home_tz: zone,
            bedtime,
          };
          for (const [key, message] of Object.entries(result.fieldErrors)) {
            const control = controls[key];
            if (control === undefined) continue;
            const node = errorNodeFor(form, control.id);
            if (node !== null) setText(node, message);
          }
          return;
        }
        if (result.errorCode === 'enrollment_closed') setText(status, COPY.enrollmentClosed);
        else if (result.errorCode === 'already_enrolled') setText(status, COPY.alreadyEnrolled);
      })();
    });
  })();
  return screen;
}
