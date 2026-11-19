import {
  ALERT_WORD,
  EMPTY,
  ERRORS,
  OFFER_WORD,
  OUTAGE,
  PENDING,
  SUCCESS,
  acceptDialogLines,
} from '../../shared/copy';
import { formatPounds } from '../../shared/format';
import type { AlertDto, OwnerOfferDto } from '../../shared/types';
import { ApiRefusal, ApiUnreachable, newIdempotencyKey, request } from '../shared/api';
import { showNotice } from '../shared/chrome';
import { el, focusTarget, onPress, setPending } from '../shared/dom';
import { announce } from '../shared/live';
import { focusFirstControl, openOverlay, type Overlay } from '../shared/overlay';
import { bindTimeLeft } from '../shared/timeleft';
import { dataTable, sectionShell, showFieldError, type SectionContext, type SectionView } from './sectionKit';
import { ownerAction, sessionEnded } from './session';
import type { CarFileState } from './state';

/** Viewings: the slot form and the slot list in London time. */
export const viewingsSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('viewings', 'Viewings');

  const when = el('input', { type: 'text', class: 'text-input', id: 'slot-when', placeholder: 'YYYY-MM-DDTHH:mm' }) as HTMLInputElement;
  when.setAttribute('aria-label', 'Viewing date and time');
  const whenError = el('p', { class: 'field-error' });
  whenError.hidden = true;
  const minutes = el('input', {
    type: 'number',
    class: 'spin-input figures',
    id: 'slot-minutes',
    min: '15',
    max: '240',
    step: '5',
    value: '45',
  }) as HTMLInputElement;
  minutes.setAttribute('aria-label', 'Viewing length in minutes');
  const minutesError = el('p', { class: 'field-error' });
  minutesError.hidden = true;
  const add = el('button', { type: 'button', class: 'pill-solid', text: 'Add viewing slot' });
  const list = el('ul', { class: 'owner-slot-list', role: 'list', 'aria-label': 'Viewing slots' });

  onPress(add, () => {
    void ownerAction(async () => {
      setPending(add, true);
      announce(context.status, PENDING.addSlot);
      showFieldError(whenError, undefined);
      showFieldError(minutesError, undefined);
      try {
        await request(`/api/owner/cars/${context.carId}/slots`, {
          method: 'POST',
          body: { localStart: when.value, durationMinutes: Number(minutes.value) },
        });
        when.value = '';
        await context.refresh(['viewings']);
        announce(context.status, SUCCESS.addSlot);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          showFieldError(whenError, error.body.errors?.localStart);
          showFieldError(minutesError, error.body.errors?.durationMinutes);
          const message =
            error.body.errors?.localStart ?? error.body.errors?.durationMinutes ?? error.body.message;
          announce(context.status, message);
          return;
        }
        throw error;
      } finally {
        setPending(add, false);
      }
    }, add);
  });

  const paint = (state: CarFileState): void => {
    if (state.slots.length === 0) {
      list.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.viewings }));
      return;
    }
    list.replaceChildren(
      ...state.slots.map((slot) =>
        el('li', { class: 'owner-slot', 'data-slot-id': slot.id }, [
          el('span', { class: 'slot-label figures', text: slot.label }),
          el('span', { class: 'slot-length figures', text: `${slot.durationMinutes} minutes` }),
          el('span', { class: 'slot-holder', text: slot.holderName ?? (slot.held ? 'Held' : 'Free') }),
        ]),
      ),
    );
  };

  section.append(
    el('div', { class: 'card' }, [
      el('label', { class: 'field-label', for: 'slot-when', text: 'Viewing date and time' }),
      when,
      whenError,
      el('label', { class: 'field-label', for: 'slot-minutes', text: 'Viewing length in minutes' }),
      minutes,
      minutesError,
      add,
    ]),
    list,
  );

  return { id: 'viewings', heading, node: section, paint };
};

/** Offers: the offers table and the acceptance confirmation dialog. */
export const offersSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('offers', 'Offers');

  const body = el('tbody', { role: 'rowgroup' });
  const table = dataTable('Offers', ['Buyer', 'Amount', 'Status', 'Seen', 'Time left', 'Actions'], body);

  let acceptDialog: Overlay | null = null;
  let acceptKey: { offerId: string; key: string } | null = null;

  const openAcceptDialog = (offer: OwnerOfferDto, opener: HTMLElement): void => {
    if (acceptDialog !== null && acceptDialog.exiting) {
      acceptDialog.cancelExit();
      acceptKey = null;
    }
    if (acceptKey === null || acceptKey.offerId !== offer.id) {
      acceptKey = { offerId: offer.id, key: newIdempotencyKey() };
    }
    const overlay = openOverlay({
      name: 'Accept offer',
      variant: 'accept',
      opener,
      scrimCloses: false,
      onClosed: () => {
        acceptDialog = null;
        context.onOverlayClosed?.();
      },
    });
    acceptDialog = overlay;

    const amountLine = el('p', { class: 'dialog-line' });
    const closedLine = el('p', { class: 'dialog-line' });
    const confirm = el('button', { type: 'button', class: 'pill-solid', text: 'Confirm acceptance' });
    const cancel = el('button', { type: 'button', class: 'pill-outline', text: 'Cancel' });

    const paintLines = (): void => {
      const current = context.state().offers.find((candidate) => candidate.id === offer.id) ?? offer;
      const others = context
        .state()
        .offers.filter(
          (candidate) =>
            candidate.id !== offer.id && (candidate.status === 'open' || candidate.status === 'needs_reread'),
        ).length;
      const lines = acceptDialogLines(formatPounds(current.amountPounds), current.buyerName, others);
      amountLine.textContent = lines[0];
      closedLine.textContent = lines[1];
    };
    paintLines();
    overlay.dialog.dataset.offerId = offer.id;
    (overlay.dialog as HTMLElement & { refreshLines?: () => void }).refreshLines = paintLines;

    onPress(cancel, () => overlay.close());
    onPress(confirm, () => {
      void ownerAction(async () => {
        if (acceptKey === null) return;
        setPending(confirm, true);
        announce(overlay.status, PENDING.accept);
        try {
          await request(`/api/owner/offers/${offer.id}/accept`, {
            method: 'POST',
            idempotencyKey: acceptKey.key,
          });
          acceptKey = null;
          await context.refresh(['offers', 'publish', 'people']);
          announce(context.status, SUCCESS.accept);
          overlay.close(heading);
        } catch (error) {
          // An ended session is the sign-in dialog’s business, not this handler’s.
          if (sessionEnded(error)) throw error;
          if (error instanceof ApiUnreachable) {
            announce(overlay.status, OUTAGE.sendFailed);
            return;
          }
          if (error instanceof ApiRefusal) {
            if (error.status >= 500) {
              announce(overlay.status, OUTAGE.sendFailed);
              return;
            }
            announce(overlay.status, acceptRefusalCopy(error));
            confirm.remove();
            await context.refresh(['offers']);
            return;
          }
          throw error;
        } finally {
          if (confirm.isConnected) setPending(confirm, false);
        }
      }, confirm);
    });

    overlay.body.append(
      el('h2', { class: 'dialog-heading', text: 'Accept offer' }),
      amountLine,
      closedLine,
      el('div', { class: 'dialog-actions' }, [confirm, cancel]),
    );
    focusFirstControl(overlay);
  };

  const acceptRefusalCopy = (error: ApiRefusal): string => {
    if (error.code === 'offer_already_accepted') return ERRORS.offerAlreadyAccepted;
    if (error.code === 'offer_lapsed') return ERRORS.offerLapsed;
    if (error.code === 'offer_needs_reread') return ERRORS.offerNeedsReread;
    if (error.code === 'offer_not_open') return ERRORS.offerNotOpen;
    return error.body.message;
  };

  const decline = (offer: OwnerOfferDto, control: HTMLElement): void => {
    void ownerAction(async () => {
      setPending(control, true);
      announce(context.status, PENDING.decline);
      try {
        await request(`/api/owner/offers/${offer.id}/decline`, { method: 'POST' });
        await context.refresh(['offers']);
        announce(context.status, SUCCESS.decline);
        focusTarget(heading);
      } catch (error) {
        // An ended session is the sign-in dialog’s business, not this handler’s.
        if (sessionEnded(error)) throw error;
        if (error instanceof ApiRefusal) {
          announce(context.status, acceptRefusalCopy(error));
          await context.refresh(['offers']);
          return;
        }
        throw error;
      } finally {
        if (control.isConnected) setPending(control, false);
      }
    }, control);
  };

  const paint = (state: CarFileState): void => {
    const open = acceptDialog;
    if (open !== null && open.open) {
      const refresh = (open.dialog as HTMLElement & { refreshLines?: () => void }).refreshLines;
      refresh?.();
    }

    if (state.offers.length === 0) {
      body.replaceChildren(el('tr', { role: 'row' }, [el('td', { role: 'cell', text: EMPTY.offers })]));
      return;
    }

    body.replaceChildren(
      ...state.offers.map((offer) => {
        const actions = el('td', { class: 'actions-cell', role: 'cell' });
        if (offer.status === 'open') {
          const accept = el('button', { type: 'button', class: 'pill-solid', text: 'Accept' });
          onPress(accept, () => openAcceptDialog(offer, accept));
          actions.append(accept);
        }
        if (offer.status === 'open' || offer.status === 'needs_reread') {
          const declineButton = el('button', { type: 'button', class: 'pill-outline', text: 'Decline' });
          onPress(declineButton, () => decline(offer, declineButton));
          actions.append(declineButton);
        }

        const timeCell = el('td', { class: 'time-cell figures', role: 'cell' });
        if (offer.status === 'open' || offer.status === 'needs_reread') {
          const time = el('span', { class: 'figures' });
          bindTimeLeft(time, offer.secondsRemaining);
          timeCell.append(time);
        }

        return el('tr', { class: 'offer-row', role: 'row', 'data-offer-id': offer.id }, [
          el('td', { role: 'cell', text: offer.buyerName }),
          el('td', { class: 'figures', role: 'cell', text: formatPounds(offer.amountPounds) }),
          el('td', { role: 'cell', text: OFFER_WORD[offer.status] }),
          el('td', { class: 'figures', role: 'cell', text: `${offer.seen} of ${offer.total}` }),
          timeCell,
          actions,
        ]);
      }),
    );
  };

  section.append(table);

  return { id: 'offers', heading, node: section, paint };
};

/** Alerts: failed alerts only have Retry. */
export const alertsSection = (context: SectionContext): SectionView => {
  const { section, heading } = sectionShell('alerts', 'Alerts');
  const list = el('ul', { class: 'alert-list', role: 'list', 'aria-label': 'Alerts' });

  const paint = (state: CarFileState): void => {
    if (state.alerts.length === 0) {
      list.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.alerts }));
      return;
    }
    list.replaceChildren(
      ...state.alerts.map((alert) => {
        const item = el('li', { class: 'alert-item', 'data-alert-id': alert.id }, [
          el('span', { class: 'alert-kind', text: alertKindWord(alert) }),
          el('span', { class: 'alert-word', text: ALERT_WORD[alert.state] }),
        ]);
        if (alert.state === 'failed') {
          const retry = el('button', { type: 'button', class: 'pill-outline', text: 'Retry' });
          onPress(retry, () => {
            void retryAlert(context, alert, retry, item);
          });
          item.append(retry);
        }
        return item;
      }),
    );
  };

  section.append(list);
  return { id: 'alerts', heading, node: section, paint };
};

const alertKindWord = (alert: AlertDto): string => {
  if (alert.kind === 'viewing_claim') return 'New viewing claim';
  if (alert.kind === 'new_offer') return 'New offer';
  return 'Offer about to lapse';
};

/**
 * Retrying a failed alert announces each step, repeats a repeated failure, and reports
 * a retry already under way.
 */
export const retryAlert = async (
  context: SectionContext,
  alert: AlertDto,
  control: HTMLElement,
  home: HTMLElement,
  status: HTMLElement = context.status,
  notice: HTMLElement = context.notice,
): Promise<void> => {
  await ownerAction(async () => {
    setPending(control, true);
    announce(status, PENDING.retryAlert);
    try {
      await request(`/api/owner/alerts/${alert.id}/retry`, { method: 'POST' });
      await context.refresh(['alerts']);
      announce(status, SUCCESS.retryAlert);
      if (!control.isConnected) focusTarget(home);
    } catch (error) {
      // An ended session is the sign-in dialog’s business, not this handler’s.
      if (sessionEnded(error)) throw error;
      if (error instanceof ApiRefusal) {
        if (error.code === 'alert_undelivered') {
          showNotice(notice, OUTAGE.alert);
          await context.refresh(['alerts']);
          focusTarget(control);
          return;
        }
        if (error.code === 'alert_retry_in_progress' || error.code === 'alert_already_delivered') {
          announce(status, ERRORS.alertRetryInProgress);
          focusTarget(control);
          return;
        }
        announce(status, error.body.message);
        return;
      }
      if (error instanceof ApiUnreachable) {
        showNotice(notice, OUTAGE.alert);
        focusTarget(control);
        return;
      }
      throw error;
    } finally {
      if (control.isConnected) setPending(control, false);
    }
  }, control);
};
