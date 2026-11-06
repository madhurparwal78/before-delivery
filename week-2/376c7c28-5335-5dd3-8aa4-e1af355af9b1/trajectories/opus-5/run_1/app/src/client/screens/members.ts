import { get, post, RequestFailed } from '../api.ts';
import type { ScreenRender } from '../app.ts';
import { openDialog } from '../dialog.ts';
import { el, field, replace, setFieldError } from '../dom.ts';
import { centsFromDollarText, dollars, money } from '../format.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import { chargeKindLabel, chargeStatusLabel } from './passport.ts';
import type { Charge, Member, MemberDetail } from '../types.ts';

export const renderMembers: ScreenRender = ({ mount }) => {
  const region = new Region('Members status');
  const search = el('input', { type: 'search', 'aria-label': 'Search members', class: 'search' });
  const tableBody = el('tbody');
  const detail = el('section', { class: 'panel detail' });
  let selectedId: string | null = null;

  mount.appendChild(
    el('div', { class: 'split-members' }, [
      el('section', { class: 'panel' }, [
        el('h1', { class: 'heading', text: 'MEMBERS' }),
        search,
        region.node,
        el('table', { class: 'table', 'aria-label': 'Members' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Name' }),
              el('th', { scope: 'col', text: 'Handle' }),
              el('th', { scope: 'col', text: 'Balance' }),
              el('th', { scope: 'col', text: 'Card' }),
            ]),
          ]),
          tableBody,
        ]),
      ]),
      detail,
    ]),
  );

  const drawDetail = (member: MemberDetail): void => {
    const adjust = el('button', { type: 'button', class: 'btn ghost', text: 'ADJUST CREDIT' });
    adjust.addEventListener('click', () => openAdjust(member, adjust));
    const activeButton = member.active
      ? el('button', { type: 'button', class: 'btn ghost', text: 'DEACTIVATE' })
      : el('button', { type: 'button', class: 'btn ghost', text: 'REACTIVATE' });
    activeButton.addEventListener('click', () => {
      if (member.active) openDeactivate(member, activeButton);
      else void sendReactivate(member, activeButton);
    });

    replace(detail, [
      el('h2', { class: 'heading small', text: member.name }),
      member.active ? null : el('span', { class: 'tag', text: 'INACTIVE' }),
      el('p', {
        class: 'mono huge',
        text: member.balance_cents < 0
          ? `OWING $${dollars(-member.balance_cents)}`
          : `BALANCE $${dollars(member.balance_cents)}`,
      }),
      el('p', { class: 'muted', text: member.email }),
      el('div', { class: 'row' }, [adjust, activeButton]),
      el('table', { class: 'table', 'aria-label': 'Charges' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Piece' }),
            el('th', { scope: 'col', text: 'Charge' }),
            el('th', { scope: 'col', text: 'Fee' }),
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Refund' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          member.charges.map((charge) => {
            let action: HTMLElement | null = null;
            if (charge.status === 'settled') {
              const button = el('button', {
                type: 'button',
                class: 'btn ghost small',
                'aria-label': `Refund ${charge.piece_title}`,
                text: 'REFUND',
              });
              button.addEventListener('click', () => openRefund(charge, member, button));
              action = button;
            }
            return el('tr', {}, [
              el('td', { text: charge.piece_title }),
              el('td', { text: chargeKindLabel(charge) }),
              el('td', { class: 'mono', text: `$${dollars(charge.fee_cents)}` }),
              el('td', { text: chargeStatusLabel(charge) }),
              el('td', {}, [action]),
            ]);
          }),
        ),
      ]),
      el('table', { class: 'table ledger', 'aria-label': 'Ledger' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Movement' }),
            el('th', { scope: 'col', text: 'Account' }),
            el('th', { scope: 'col', text: 'Amount' }),
          ]),
        ]),
        el(
          'tbody',
          {},
          member.entries.map((entry) =>
            el('tr', {}, [
              el('td', { text: entry.kind }),
              el('td', { text: entry.account }),
              el('td', { class: 'mono', text: money(entry.amount_cents) }),
            ]),
          ),
        ),
      ]),
    ]);
  };

  const openDetail = async (id: string): Promise<void> => {
    selectedId = id;
    const member = await get<MemberDetail>(`/api/members/${id}`).catch(() => null);
    if (member) drawDetail(member);
  };

  const openAdjust = (member: MemberDetail, opener: HTMLElement): void => {
    const amountInput = el('input', { type: 'text', 'aria-label': 'Amount ($)' });
    const reasonInput = el('input', { type: 'text', 'aria-label': 'Reason' });
    const amountField = field('Amount ($)', amountInput, 'adjust-amount');
    const reasonField = field('Reason', reasonInput, 'adjust-reason');
    const submit = el('button', { type: 'button', class: 'btn primary', text: 'POST ADJUSTMENT' });
    const dialog = openDialog({
      label: 'Adjust credit',
      opener,
      children: [
        el('h2', { class: 'heading small', text: 'ADJUST CREDIT' }),
        amountField.wrap,
        reasonField.wrap,
        submit,
      ],
    });
    submit.addEventListener('click', () => {
      setFieldError(amountInput, amountField.error, '');
      setFieldError(reasonInput, reasonField.error, '');
      void withPending(region, submit, 'Posting…', async () => {
        const cents = centsFromDollarText(amountInput.value);
        if (cents === null) {
          setFieldError(
            amountInput,
            amountField.error,
            'Enter a non-zero amount up to $1,000.00 either way.',
          );
          region.say('Fix the highlighted fields.');
          return;
        }
        try {
          const answer = await post<{ balance_cents: number }>(
            `/api/members/${member.id}/adjustments`,
            { amount_cents: cents, reason: reasonInput.value },
          );
          dialog.close();
          region.say(`Adjustment posted. Balance $${dollars(answer.balance_cents)}.`);
          await openDetail(member.id);
          await load();
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          const errors = error.failure.errors ?? {};
          setFieldError(amountInput, amountField.error, errors['amount_cents'] ?? '');
          setFieldError(reasonInput, reasonField.error, errors['reason'] ?? '');
          region.say(failureCopy(error.failure, {}));
        }
      });
    });
  };

  const openRefund = (charge: Charge, member: MemberDetail, opener: HTMLElement): void => {
    const reasonInput = el('input', { type: 'text', 'aria-label': 'Reason' });
    const reasonField = field('Reason', reasonInput, 'refund-reason');
    const submit = el('button', { type: 'button', class: 'btn primary', text: 'CONFIRM REFUND' });
    const dialog = openDialog({
      label: 'Refund charge',
      opener,
      children: [
        el('h2', { class: 'heading small', text: `REFUND ${charge.piece_title}` }),
        reasonField.wrap,
        submit,
      ],
    });
    submit.addEventListener('click', () => {
      setFieldError(reasonInput, reasonField.error, '');
      void withPending(region, submit, 'Refunding…', async () => {
        try {
          const answer = await post<{
            balance_cents: number;
            charge: { status: string };
          }>(`/api/charges/${charge.id}/refund`, { reason: reasonInput.value });
          dialog.close();
          if (answer.charge.status === 'refunded') {
            region.say(`Refund issued. Balance $${dollars(answer.balance_cents)}.`);
          } else {
            region.say(
              'Refund sent to billing. It shows as Refund pending until billing confirms it.',
            );
          }
          await openDetail(member.id);
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          const errors = error.failure.errors ?? {};
          setFieldError(reasonInput, reasonField.error, errors['reason'] ?? '');
          region.say(
            failureCopy(error.failure, {
              charge_not_refundable: 'Only a settled charge can be refunded.',
              billing_unavailable:
                'Billing is unavailable. Try again in a few minutes; a charge is never refunded twice.',
            }),
          );
        }
      });
    });
  };

  const openDeactivate = (member: MemberDetail, opener: HTMLElement): void => {
    const confirm = el('button', { type: 'button', class: 'btn primary', text: 'CONFIRM DEACTIVATION' });
    const cancel = el('button', { type: 'button', class: 'btn ghost', text: 'CANCEL' });
    const dialog = openDialog({
      label: 'Deactivate member',
      opener,
      children: [
        el('h2', { class: 'heading small', text: `DEACTIVATE ${member.name}` }),
        el('div', { class: 'row' }, [confirm, cancel]),
      ],
    });
    cancel.addEventListener('click', () => dialog.close());
    confirm.addEventListener('click', () => {
      void withPending(region, confirm, 'Deactivating…', async () => {
        try {
          await post(`/api/members/${member.id}/deactivate`);
          dialog.close();
          region.say(`${member.name} deactivated. Their sessions have ended.`);
          await openDetail(member.id);
          await load();
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          region.say(failureCopy(error.failure, {}));
        }
      });
    });
  };

  const sendReactivate = async (member: MemberDetail, button: HTMLButtonElement): Promise<void> => {
    await withPending(region, button, 'Reactivating…', async () => {
      try {
        await post(`/api/members/${member.id}/reactivate`);
        region.say(`${member.name} can sign in again.`);
        await openDetail(member.id);
        await load();
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(failureCopy(error.failure, {}));
      }
    });
  };

  async function load(): Promise<void> {
    const members = await get<Member[]>(
      `/api/members?q=${encodeURIComponent(search.value.trim())}`,
    ).catch(() => null);
    if (!members) return;
    replace(
      tableBody,
      members.map((member) => {
        const link = el('a', { href: `#member-${member.id}`, text: member.name });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void openDetail(member.id);
        });
        return el('tr', {}, [
          el('td', {}, [link, member.active ? null : el('span', { class: 'tag', text: 'INACTIVE' })]),
          el('td', { text: member.handle }),
          el('td', { class: 'mono', text: money(member.balance_cents) }),
          el('td', { class: 'label', text: member.card_status === 'on_file' ? 'ON FILE' : 'NONE' }),
        ]);
      }),
    );
  }

  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(), 330);
  });

  void load();
  return onLive((message) => {
    if (message.kind === 'member' || message.kind === 'credit' || message.kind === 'charge') {
      void load();
      if (selectedId) void openDetail(selectedId);
    }
  });
};
