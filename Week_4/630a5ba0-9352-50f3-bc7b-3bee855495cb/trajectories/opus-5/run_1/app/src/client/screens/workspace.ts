import type { ReviewDto, SeatsDto, WorkspaceMemberDto } from '../../shared/types.js';
import { api, RequestFailed } from '../api.js';
import { announce, fieldError, registerScreen, render, state } from '../app.js';
import { el, icon } from '../dom.js';
import { pending, textField } from '../forms.js';
import { addDays, dayLabel, isoWeekMonday, isoWeekOf, todayInZone } from '../../shared/time.js';

let week: string | null = null;

const STATUS_COPY: Record<WorkspaceMemberDto['status'], string> = {
  active: 'Active',
  invited: 'Invited',
  pending_billing: 'Waiting for billing',
};

function seatsSection(seats: SeatsDto): HTMLElement {
  const email = textField('Email', { type: 'email' });
  const send = el('button', { type: 'submit', class: 'button button--primary' }, ['Send invite']);
  const form = el('form', { 'aria-label': 'Invite a member', novalidate: true }, [email.wrapper, send]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    email.showError(null);
    const address = email.input.value.trim();
    pending(send, 'Sending…', 'Send invite');
    announce('Sending…');
    void api
      .invite(address)
      .then((result) => {
        pending(send, null, 'Send invite');
        if (result.billing === 'queued') {
          announce(
            `Invite saved. Billing is unreachable, so the seat and email will go through when it\u2019s back.`,
          );
        } else if (result.email === 'queued') {
          announce(`Invite saved. Mail is unreachable, so the email to ${address} is queued.`);
        } else {
          announce(`Invite sent to ${address}.`);
        }
        void render();
      })
      .catch((error: unknown) => {
        pending(send, null, 'Send invite');
        if (error instanceof RequestFailed && error.code === 'already_member') {
          email.showError(`${address} is already in this workspace.`);
          announce(`${address} is already in this workspace.`);
          return;
        }
        if (error instanceof RequestFailed && error.code === 'email_taken') {
          email.showError(`${address} already has a Daybook.`);
          announce(`${address} already has a Daybook.`);
          return;
        }
        email.showError(fieldError(error, 'email'));
        announce(error instanceof RequestFailed ? error.message : 'Check the highlighted fields.');
      });
  });

  return el('section', { role: 'region', 'aria-label': 'Seats', class: 'section' }, [
    el('h2', { text: 'Seats' }),
    el('p', { class: 'num', text: `Active seats: ${seats.active}` }),
    form,
  ]);
}

function membersTable(members: WorkspaceMemberDto[]): HTMLElement {
  const head = el('thead', {}, [
    el('tr', {}, [
      el('th', { scope: 'col', text: 'Name' }),
      el('th', { scope: 'col', text: 'Email' }),
      el('th', { scope: 'col', text: 'Role' }),
      el('th', { scope: 'col', text: 'Status' }),
      el('th', { scope: 'col', text: 'Actions' }),
    ]),
  ]);
  const body = el('tbody');
  for (const member of members) {
    const actions = el('td', { 'data-label': 'Actions' });
    if (member.role !== 'owner') {
      const label = member.name.trim().length > 0 ? member.name : member.email;
      const remove = el('button', { type: 'button', class: 'button button--quiet', 'aria-label': `Remove ${label}` }, [
        'Remove',
      ]);
      remove.addEventListener('click', () => {
        pending(remove, 'Removing…', 'Remove');
        announce('Removing…');
        void api
          .removeMember(member.id)
          .then((result) => {
            announce(`Removed ${label}. Active seats: ${result.seats.active}.`);
            void render();
          })
          .catch((error: unknown) => {
            pending(remove, null, 'Remove');
            if (error instanceof RequestFailed && error.code === 'billing_unavailable') {
              announce(`Billing is unreachable, so ${label} is still a member. Try again shortly.`);
              return;
            }
            if (error instanceof RequestFailed && error.code === 'cannot_remove_owner') {
              announce("The owner can't be removed.");
              return;
            }
            announce('Something went wrong on our side. Nothing was changed.');
          });
      });
      actions.append(remove);
    }
    body.append(
      el('tr', {}, [
        el('td', { 'data-label': 'Name', text: member.name }),
        el('td', { 'data-label': 'Email', text: member.email }),
        el('td', { 'data-label': 'Role', text: member.role === 'owner' ? 'Owner' : 'Member' }),
        el('td', { 'data-label': 'Status', text: STATUS_COPY[member.status] }),
        actions,
      ]),
    );
  }
  return el('table', { class: 'data-table', 'aria-label': 'Members' }, [
    el('caption', { text: 'Members' }),
    head,
    body,
  ]);
}

function reviewSection(review: ReviewDto): HTMLElement {
  const monday = isoWeekMonday(review.week) ?? todayInZone(state.me?.member.timeZone ?? 'UTC');
  const previous = el('button', { type: 'button', class: 'button' }, [icon('chevron-left'), 'Previous week']);
  previous.setAttribute('aria-label', 'Previous week');
  const next = el('button', { type: 'button', class: 'button' }, ['Next week', icon('chevron-right')]);
  next.setAttribute('aria-label', 'Next week');
  previous.addEventListener('click', () => {
    week = isoWeekOf(addDays(monday, -7));
    void render();
  });
  next.addEventListener('click', () => {
    week = isoWeekOf(addDays(monday, 7));
    void render();
  });

  const body = el('tbody');
  for (const member of review.members) {
    body.append(
      el('tr', {}, [
        el('td', { 'data-label': 'Member', text: member.name }),
        el('td', { class: 'num', 'data-label': 'Planned', text: `${member.plannedMinutes}m` }),
        el('td', { class: 'num', 'data-label': 'Done', text: `${member.doneMinutes}m` }),
      ]),
    );
  }
  body.append(
    el('tr', {}, [
      el('td', { 'data-label': 'Member', text: 'Total' }),
      el('td', { class: 'num', 'data-label': 'Planned', text: `${review.totals.plannedMinutes}m` }),
      el('td', { class: 'num', 'data-label': 'Done', text: `${review.totals.doneMinutes}m` }),
    ]),
  );

  return el('section', { class: 'section' }, [
    el('h2', { text: `Week of ${dayLabel(monday)}` }),
    el('div', { class: 'calendar-controls' }, [previous, next]),
    el('table', { class: 'data-table', 'aria-label': 'Weekly review' }, [
      el('caption', { text: 'Weekly review' }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Member' }),
          el('th', { scope: 'col', class: 'num', text: 'Planned' }),
          el('th', { scope: 'col', class: 'num', text: 'Done' }),
        ]),
      ]),
      body,
    ]),
  ]);
}

registerScreen('/workspace', async (root) => {
  root.append(el('h2', { text: 'Workspace' }));
  const [membersResult, reviewResult] = await Promise.all([
    api.members(),
    api.review(week ?? undefined),
  ]);
  root.append(
    seatsSection(membersResult.seats),
    membersTable(membersResult.members),
    reviewSection(reviewResult),
  );
});
