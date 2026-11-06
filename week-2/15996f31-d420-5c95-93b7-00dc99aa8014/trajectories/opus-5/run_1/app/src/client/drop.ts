import type { DropView, SessionUser } from '../shared/api-types';
import { formatMoney } from '../shared/format';
import { dropStatusLabel, tierLabel } from '../shared/labels';
import { formatCalendarDate } from '../shared/pacific';
import { clear, el, request, runAction } from './core';
import { Dialog } from './dialog';
import { FormField } from './forms';
import { ledgerTable } from './table';

function photoList(drop: DropView): HTMLElement {
  return el(
    'ul',
    { class: 'photos', 'aria-label': 'Frame photos' },
    drop.photos.map((photo) =>
      el('li', { class: 'photos__item' }, [
        el('a', {
          class: 'photos__link',
          href: photo.url,
          target: '_blank',
          rel: 'noopener',
          text: `Photo, colony ${photo.colony_label}`,
        }),
        el('img', {
          class: 'photos__thumb',
          src: photo.url,
          alt: `Frame photo of colony ${photo.colony_label}`,
          loading: 'lazy',
        }),
      ]),
    ),
  );
}

function disputeDialog(opener: HTMLButtonElement, drop: DropView, reload: () => void): Dialog {
  const reason = new FormField({ name: 'reason', label: 'Reason', kind: 'textarea' });
  return new Dialog({
    name: 'Dispute inspection',
    opener,
    fields: [reason],
    submitLabel: 'Send dispute',
    submit: async (self) => {
      self.clearErrors();
      const result = await runAction({
        button: self.submitButton,
        pending: 'Sending dispute…',
        run: () =>
          request<DropView>('POST', `/api/drops/${drop.id}/dispute`, {
            body: { reason: reason.value },
          }),
        success: () => 'Dispute sent to the broker.',
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        reload();
      }
    },
  });
}

function resolveDialog(opener: HTMLButtonElement, drop: DropView, reload: () => void): Dialog {
  const note = new FormField({ name: 'note', label: 'Resolution note', kind: 'textarea' });
  return new Dialog({
    name: 'Resolve dispute',
    opener,
    fields: [note],
    submitLabel: 'Resolve',
    submit: async (self) => {
      self.clearErrors();
      const result = await runAction({
        button: self.submitButton,
        pending: 'Resolving dispute…',
        run: () =>
          request<DropView>('POST', `/api/drops/${drop.id}/resolve`, {
            body: { note: note.value },
          }),
        success: () => `Dispute resolved. ${drop.yard_name} is accepted.`,
        onFailure: (failure) => self.showFailure(failure),
      });
      if (result !== null) {
        self.close();
        reload();
      }
    },
  });
}

export async function renderDrop(
  root: HTMLElement,
  user: SessionUser,
  dropId: string,
): Promise<void> {
  const body = el('main', { class: 'drop' });
  const signOut = el('button', {
    type: 'button',
    class: 'button button--quiet',
    text: 'Sign out',
  });
  signOut.addEventListener('click', () => {
    void request('DELETE', '/api/session').then(() => window.location.assign('/'));
  });
  root.append(
    el('header', { class: 'topbar' }, [
      el('p', { class: 'wordmark wordmark--small', text: 'Swarmline Bloom Desk' }),
      el('p', { class: 'topbar__who' }, [
        el('span', { class: 'topbar__name', text: user.name }),
        el('span', { class: 'topbar__role', text: user.role }),
      ]),
      signOut,
    ]),
    body,
  );

  const paint = (drop: DropView): void => {
    clear(body);
    const samples = drop.photos.length;
    body.append(
      el('a', { class: 'link link--back', href: '/desk', text: 'Back to the desk' }),
      el('h1', { class: 'drop__title', text: `${drop.yard_name} · ${drop.hives} hives` }),
      el('p', {
        class: 'drop__where',
        text: `${drop.orchard.name} · ${drop.order.ref} · ${drop.block?.name ?? 'No block yet'}`,
      }),
      ledgerTable([
        { label: 'Status', value: dropStatusLabel(drop.status) },
        { label: 'Hives', value: el('span', { class: 'figure', text: String(drop.hives) }) },
        {
          label: 'Delivered',
          value: el('span', {
            class: 'figure',
            text: drop.delivered_on === null ? '—' : formatCalendarDate(drop.delivered_on),
          }),
        },
        {
          label: 'Drop strength',
          value: el('span', {
            class: 'figure',
            text: drop.average_frames === null ? '—' : `${drop.average_frames.toFixed(1)} frames`,
          }),
        },
        {
          label: 'Block strength',
          value: el('span', {
            class: 'figure',
            text:
              drop.block_average_frames === null
                ? '—'
                : `${drop.block_average_frames.toFixed(1)} frames`,
          }),
        },
        { label: 'Block tier', value: tierLabel(drop.tier) },
        {
          label: 'Pay per hive',
          value: el('span', {
            class: 'figure',
            text: drop.pay_per_hive_cents === null ? '—' : formatMoney(drop.pay_per_hive_cents),
          }),
        },
        {
          label: 'Expected pay',
          value: el('span', {
            class: 'figure',
            text: drop.payout_cents === null ? '—' : formatMoney(drop.payout_cents),
          }),
        },
      ]),
    );
    if (drop.dispute_reason !== null) {
      body.append(
        el('p', { class: 'drop__dispute' }, [
          el('span', { class: 'drop__dispute-label', text: 'Dispute reason' }),
          el('span', { text: drop.dispute_reason }),
        ]),
      );
    }
    if (drop.resolution_note !== null) {
      body.append(
        el('p', { class: 'drop__dispute' }, [
          el('span', { class: 'drop__dispute-label', text: 'Resolution note' }),
          el('span', { text: drop.resolution_note }),
        ]),
      );
    }

    body.append(
      el('h2', { class: 'section__title', text: 'Sampled colonies' }),
      el('div', { class: 'samples' }, [
        ...(samples === 0 ? [el('p', { class: 'empty', text: 'No frame photos yet.' })] : []),
        photoList(drop),
      ]),
    );

    const actions = el('div', { class: 'drop__actions' });
    if (user.role === 'beekeeper') {
      const accept = el('button', {
        type: 'button',
        class: 'button button--primary',
        text: 'Accept inspection',
      });
      accept.dataset.label = 'Accept inspection';
      accept.addEventListener('click', () => {
        void runAction({
          button: accept,
          pending: 'Accepting inspection…',
          run: () => request<DropView>('POST', `/api/drops/${drop.id}/accept`, { body: {} }),
          success: () => `Inspection accepted for ${drop.yard_name}.`,
        }).then((updated) => {
          if (updated !== null) paint(updated);
        });
      });
      const dispute = el('button', {
        type: 'button',
        class: 'button',
        text: 'Dispute inspection',
      });
      dispute.dataset.label = 'Dispute inspection';
      dispute.addEventListener('click', () => {
        disputeDialog(dispute, drop, () => void reload()).open();
      });
      actions.append(accept, dispute);
    }
    if (user.role === 'broker') {
      const resolve = el('button', {
        type: 'button',
        class: 'button button--primary',
        text: 'Resolve dispute',
      });
      resolve.dataset.label = 'Resolve dispute';
      resolve.addEventListener('click', () => {
        resolveDialog(resolve, drop, () => void reload()).open();
      });
      actions.append(resolve);
    }
    body.append(actions);
  };

  const reload = async (): Promise<void> => {
    paint(await request<DropView>('GET', `/api/drops/${dropId}`));
  };
  await reload();
}
