import type { OperatorClubRow } from '../../shared/api';
import { api } from '../api';
import { copy } from '../copy';
import { el, replace } from '../dom';
import type { ScreenContext, ScreenHandle } from '../main';
import { button, formAlert, formatInZone, labelledField, liveRegion, runAction } from '../ui';

function failureText(row: OperatorClubRow): string {
  if (!row.lastDeliveryFailure) return 'None';
  const service = row.lastDeliveryFailure.service;
  const label = service === 'renderer' ? 'Renderer' : service === 'storage' ? 'Storage' : 'Mail';
  const stamp = formatInZone(row.lastDeliveryFailure.at, 'UTC');
  return `${label} at ${stamp.date} ${stamp.time} UTC`;
}

export function renderOperator(ctx: ScreenContext): ScreenHandle {
  const updates = liveRegion('Operator updates');
  const tableHost = el('div', { class: 'operator-table' });
  const alert = formAlert();
  const slug = labelledField({ label: 'Club slug', id: 'club-slug' });
  const name = labelledField({ label: 'Club name', id: 'club-name' });
  const timeZone = labelledField({
    label: 'Time zone',
    id: 'club-zone',
    hint: 'IANA name, for example America/Denver',
  });
  const chairName = labelledField({ label: 'Chair name', id: 'chair-name' });
  const chairEmail = labelledField({ label: 'Chair email', id: 'chair-email', type: 'email' });
  const chairPassword = labelledField({
    label: 'Chair password',
    id: 'chair-password',
    type: 'password',
    hint: 'At least 10 characters.',
  });
  const submit = button('Onboard club', { variant: 'primary', onClick: () => void onboard() });

  const form = el(
    'form',
    {
      class: 'form',
      attrs: { 'aria-label': 'Onboard club', novalidate: 'novalidate' },
      on: {
        submit: (event: SubmitEvent) => {
          event.preventDefault();
          void onboard();
        },
      },
    },
    alert.element,
    slug.wrapper,
    name.wrapper,
    timeZone.wrapper,
    chairName.wrapper,
    chairEmail.wrapper,
    chairPassword.wrapper,
    submit,
  );

  const container = el(
    'div',
    { class: 'screen' },
    el('h1', { class: 'page-heading', text: 'Club workspaces' }),
    updates,
    tableHost,
    form,
  );

  function paint(clubs: OperatorClubRow[]): void {
    replace(
      tableHost,
      el(
        'table',
        { class: 'data-table', attrs: { 'aria-label': 'Club workspaces' } },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: 'Club' }),
            el('th', { text: 'Time zone' }),
            el('th', { class: 'num', text: 'Events' }),
            el('th', { class: 'num', text: 'Drivers' }),
            el('th', { class: 'num', text: 'Published' }),
            el('th', { text: 'Last delivery failure' }),
          ),
        ),
        el(
          'tbody',
          {},
          clubs.map((club) =>
            el(
              'tr',
              {},
              el('td', { text: club.name }),
              el('td', { text: club.timeZone }),
              el('td', { class: 'num mono', text: String(club.eventCount) }),
              el('td', { class: 'num mono', text: String(club.driverCount) }),
              el('td', { class: 'num mono', text: String(club.publishedCount) }),
              el('td', { text: failureText(club) }),
            ),
          ),
        ),
      ),
    );
  }

  async function reload(): Promise<void> {
    const result = await api.operator.clubs();
    paint(result.clubs);
  }

  async function onboard(): Promise<void> {
    const result = await runAction({
      control: submit,
      region: updates,
      pending: copy.operator.pending,
      run: () =>
        api.operator.onboard({
          slug: slug.input.value.trim(),
          name: name.input.value.trim(),
          timeZone: timeZone.input.value.trim(),
          chair: {
            name: chairName.input.value.trim(),
            email: chairEmail.input.value.trim(),
            password: chairPassword.input.value,
          },
        }),
      success: (created) =>
        copy.operator.created(created.club.name, created.chair.user.name),
      failure: (error) => {
        if (error.code === 'slug_taken') return copy.operator.slugTaken;
        if (error.code === 'email_taken') return copy.operator.emailTaken;
        if (error.status === 422) {
          alert.fields(
            Object.entries(error.fields).map(([field, message]) => ({
              message,
              focus: () => {
                const map: Record<string, HTMLElement> = {
                  slug: slug.input,
                  name: name.input,
                  timeZone: timeZone.input,
                  'chair.name': chairName.input,
                  'chair.email': chairEmail.input,
                  'chair.password': chairPassword.input,
                };
                (map[field] ?? slug.input).focus();
              },
            })),
          );
          return Object.values(error.fields)[0] ?? error.message;
        }
        return error.message;
      },
    });
    if (result) {
      alert.reset();
      for (const field of [slug, name, timeZone, chairName, chairEmail, chairPassword]) {
        field.input.value = '';
      }
      await reload();
    }
  }

  void reload();
  void ctx;
  return { element: container };
}
