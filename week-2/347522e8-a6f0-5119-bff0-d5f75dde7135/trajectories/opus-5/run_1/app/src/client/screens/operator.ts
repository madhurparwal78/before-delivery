/**
 * Operator: the renters table with its review dialog, the stations and their
 * effective-dated settings, the compliance links and the notification outbox.
 */

import { api, ApiError, inBackground, messageFor } from '../api.js';
import { serverNow } from '../clock.js';
import * as copy from '../../shared/copy.js';
import { formatHours } from '../../shared/format.js';
import { kitchenDate, kitchenHhmm, kitchenZoneAbbrev } from '../../shared/kitchenTime.js';
import type {
  ComplianceDocument,
  ComplianceLink,
  Notification,
  Renter,
  RenterSummary,
  Station,
  StationsResponse,
} from '../../shared/types.js';
import { clear, el, field, setFieldError } from '../dom.js';
import { documentWord, latestPerKind } from '../documentWord.js';
import { openDialog } from '../ui/dialog.js';
import type { Cleanup, ScreenContext } from '../router.js';

const EXPIRY_CHOICES = [
  { label: '1 hour', seconds: 3_600 },
  { label: '1 day', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
  { label: '30 days', seconds: 2_592_000 },
];

function stamp(iso: string): string {
  const ms = Date.parse(iso);
  return `${kitchenDate(ms)} ${kitchenHhmm(ms)} ${kitchenZoneAbbrev(ms)}`;
}

export function operatorScreen(context: ScreenContext): Cleanup {
  let today = kitchenDate(serverNow());

  const heading = el('h1', { text: 'Operator', attrs: { tabindex: '-1' } });
  const operatorStatus = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Operator status', 'aria-live': 'polite' },
  });

  const rentersBody = el('tbody', {});
  const stationsBody = el('tbody', {});
  const linksList = el('div', {});
  const notificationsBody = el('tbody', {});

  const linkLabel = el('input', { attrs: { type: 'text' } });
  const linkLabelField = field('Link label', linkLabel, 'link-label');
  const linkExpiry = el(
    'select',
    {},
    EXPIRY_CHOICES.map((choice) =>
      el('option', { text: choice.label, attrs: { value: String(choice.seconds) } }),
    ),
  );
  const linkExpiryField = field('Expires after', linkExpiry, 'link-expiry');
  const createLink = el('button', {
    class: 'btn btn--primary',
    text: 'Create link',
    attrs: { type: 'submit' },
  });

  context.root.append(
    heading,
    operatorStatus,
    el('div', { class: 'cols cols--2' }, [
      el('div', {}, [
        el('section', { class: 'panel' }, [
          el('h2', { text: 'Renters' }),
          el('table', { class: 'card-table', attrs: { 'aria-label': 'Renters' } }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Business' }),
                el('th', { text: 'Status' }),
                el('th', { text: 'Compliance' }),
                el('th', { class: 'num', text: 'Balance' }),
                el('th', { text: 'Review' }),
              ]),
            ]),
            rentersBody,
          ]),
        ]),
        el('section', { class: 'panel' }, [
          el('h2', { text: 'Stations' }),
          el('table', { class: 'card-table', attrs: { 'aria-label': 'Stations' } }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Station' }),
                el('th', { class: 'num', text: 'Weight' }),
                el('th', { class: 'num', text: 'Off-peak %' }),
                el('th', { class: 'num', text: 'Overage/h' }),
                el('th', { class: 'num', text: 'Buffer' }),
                el('th', { text: 'Settings' }),
              ]),
            ]),
            stationsBody,
          ]),
        ]),
      ]),
      el('div', {}, [
        el('section', { class: 'panel', attrs: { role: 'region', 'aria-label': 'Compliance links' } }, [
          el('h2', { text: 'Compliance links' }),
          linksList,
          el('form', { attrs: { id: 'link-form' } }, [
            linkLabelField.wrapper,
            linkExpiryField.wrapper,
            createLink,
          ]),
        ]),
        el('section', { class: 'panel' }, [
          el('h2', { text: 'Notifications' }),
          el('table', { class: 'card-table', attrs: { 'aria-label': 'Notifications' } }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Kind' }),
                el('th', { text: 'To' }),
                el('th', { text: 'Subject' }),
                el('th', { text: 'Status' }),
                el('th', { class: 'num', text: 'Attempts' }),
              ]),
            ]),
            notificationsBody,
          ]),
        ]),
      ]),
    ]),
  );

  // ---------- renters ----------

  async function loadRenters(): Promise<void> {
    const answer = await api.get<{ renters: RenterSummary[] }>('/api/renters');
    clear(rentersBody);
    for (const renter of answer.renters) {
      const review = el('button', {
        class: 'btn',
        text: `Review ${renter.business_name}`,
        attrs: { type: 'button' },
      });
      review.addEventListener('click', () => void openReview(renter, review));
      rentersBody.append(
        el('tr', {}, [
          el('td', { text: renter.business_name, attrs: { 'data-label': 'Business' } }),
          el('td', { attrs: { 'data-label': 'Status' } }, [
            el('span', { class: 'tag', text: copy.RENTER_WORDS[renter.status] ?? renter.status }),
          ]),
          el('td', {
            text: copy.complianceLine(
              renter.compliance.state,
              [renter.compliance.coi_expires_on, renter.compliance.card_expires_on]
                .filter((value): value is string => value !== null)
                .sort()[0] ?? null,
            ),
            attrs: { 'data-label': 'Compliance' },
          }),
          el('td', {
            class: 'num',
            text: `${formatHours(renter.balance_minutes)} h`,
            attrs: { 'data-label': 'Balance' },
          }),
          el('td', { attrs: { 'data-label': 'Review' } }, [review]),
        ]),
      );
    }
  }

  async function openReview(summary: RenterSummary, opener: HTMLElement): Promise<void> {
    const body = el('div', {});
    const dialog = openDialog({
      label: `Review ${summary.business_name}`,
      opener,
      body: [body],
    });

    async function paint(): Promise<void> {
      const [renterAnswer, documentsAnswer] = await Promise.all([
        api.get<{ renter: Renter }>(`/api/renters/${summary.id}`),
        api.get<{ documents: ComplianceDocument[] }>(`/api/renters/${summary.id}/documents`),
      ]);
      const renter = renterAnswer.renter;
      clear(body);

      const close = el('button', { class: 'btn', text: 'Close', attrs: { type: 'button' } });
      close.addEventListener('click', () => dialog.close());

      const documentRows = el('div', {});
      for (const document of latestPerKind(documentsAnswer.documents)) {
        const label = copy.DOCUMENT_LABELS[document.kind];
        const word = documentWord(document, today);
        const controls: HTMLElement[] = [];
        if (document.status === 'pending_review') {
          const approve = el('button', {
            class: 'btn',
            text: `Approve ${label}`,
            attrs: { type: 'button' },
          });
          const reject = el('button', {
            class: 'btn',
            text: `Reject ${label}`,
            attrs: { type: 'button' },
          });
          approve.addEventListener('click', () => void decide(document.id, 'approve', label, paint));
          reject.addEventListener('click', () => void decide(document.id, 'reject', label, paint));
          controls.push(approve, reject);
        }
        documentRows.append(
          el('div', { class: 'share__doc' }, [
            el('span', { text: label }),
            el('span', { class: 'mono', text: document.expires_on ?? '' }),
            el('span', { class: 'tag', text: word }),
            el('a', {
              text: `View ${label}`,
              attrs: { href: `/api/documents/${document.id}/file`, 'data-external': 'true' },
            }),
            ...controls,
          ]),
        );
      }

      const activate = el('button', {
        class: 'btn',
        text: 'Activate renter',
        attrs: { type: 'button' },
      });
      const offboard = el('button', {
        class: 'btn',
        text: 'Offboard renter',
        attrs: { type: 'button' },
      });
      activate.addEventListener('click', () => void transition(renter.id, 'active', paint));
      offboard.addEventListener('click', () => void transition(renter.id, 'offboarded', paint));

      const minutesInput = el('input', { attrs: { type: 'text', inputmode: 'numeric' } });
      const reasonInput = el('input', { attrs: { type: 'text' } });
      const minutesEntry = field('Adjustment minutes', minutesInput, 'adjust-minutes');
      const reasonEntry = field('Adjustment reason', reasonInput, 'adjust-reason');
      const record = el('button', {
        class: 'btn',
        text: 'Record adjustment',
        attrs: { type: 'button' },
      });
      record.addEventListener('click', () => {
        record.disabled = true;
        setFieldError(minutesEntry.error, null);
        setFieldError(reasonEntry.error, null);
        operatorStatus.textContent = copy.SAVING;
        void (async () => {
          try {
            await api.post(`/api/renters/${renter.id}/adjustments`, {
              minutes: Number(minutesInput.value.trim()),
              reason: reasonInput.value.trim(),
            });
            operatorStatus.textContent = copy.ADJUSTMENT_RECORDED;
            await paint();
            await loadRenters();
          } catch (error) {
            record.disabled = false;
            operatorStatus.textContent = '';
            if (error instanceof ApiError && error.status === 422) {
              setFieldError(minutesEntry.error, error.fieldErrors['minutes'] ?? '');
              setFieldError(reasonEntry.error, error.fieldErrors['reason'] ?? '');
            } else {
              operatorStatus.textContent = messageFor(error);
            }
          }
        })();
      });

      const shelfLabel = el('input', { attrs: { type: 'text' } });
      const shelfEntry = field('Shelf label', shelfLabel, 'shelf-label');
      const startShelf = el('button', {
        class: 'btn',
        text: 'Start shelf subscription',
        attrs: { type: 'button' },
      });
      const endShelf = el('button', {
        class: 'btn',
        text: 'End shelf subscription',
        attrs: { type: 'button' },
      });
      startShelf.addEventListener('click', () => {
        startShelf.disabled = true;
        operatorStatus.textContent = copy.SAVING;
        void (async () => {
          try {
            await api.post(`/api/renters/${renter.id}/shelf-subscription`, {
              shelf_label: shelfLabel.value.trim(),
            });
            operatorStatus.textContent = copy.shelfStarted(renter.business_name);
            await paint();
          } catch (error) {
            startShelf.disabled = false;
            operatorStatus.textContent = messageFor(error, {
              billing_unavailable: copy.BILLING_UNREACHABLE,
              renter_not_active: copy.SHELF_RENTER_NOT_ACTIVE,
              already_subscribed: copy.GENERIC_ERROR,
            });
          }
        })();
      });
      endShelf.addEventListener('click', () => {
        endShelf.disabled = true;
        operatorStatus.textContent = copy.SAVING;
        void (async () => {
          try {
            await api.del(`/api/renters/${renter.id}/shelf-subscription`);
            operatorStatus.textContent = copy.shelfEnded(renter.business_name);
            await paint();
          } catch (error) {
            endShelf.disabled = false;
            operatorStatus.textContent = messageFor(error, {
              billing_unavailable: copy.BILLING_UNREACHABLE,
            });
          }
        })();
      });

      const shelf = renter.shelf_subscription;
      const shelfLine =
        shelf === null
          ? 'Shelf: none'
          : `Shelf: ${shelf.shelf_label} \u00b7 billing ${shelf.billing_state.toLowerCase()}`;

      body.append(
        el('h2', { text: `Review ${renter.business_name}` }),
        el('p', {}, [
          el('span', { class: 'tag', text: copy.RENTER_WORDS[renter.status] ?? renter.status }),
        ]),
        el('p', { class: 'mono', text: `${formatHours(renter.balance_minutes)} h balance` }),
        documentRows,
        el('div', { class: 'dialog__actions' }, [activate, offboard]),
        minutesEntry.wrapper,
        reasonEntry.wrapper,
        record,
        el('p', { class: 'mono', text: shelfLine }),
        shelfEntry.wrapper,
        el('div', { class: 'dialog__actions' }, [startShelf, endShelf]),
        el('div', { class: 'dialog__actions' }, [close]),
      );
    }

    await paint();
  }

  async function decide(
    documentId: string,
    decision: 'approve' | 'reject',
    label: string,
    repaint: () => Promise<void>,
  ): Promise<void> {
    operatorStatus.textContent = copy.SAVING;
    try {
      await api.post(`/api/documents/${documentId}/review`, { decision });
      operatorStatus.textContent =
        decision === 'approve' ? copy.documentApproved(label) : copy.documentRejected(label);
      await repaint();
      await loadRenters();
    } catch (error) {
      operatorStatus.textContent = messageFor(error, {
        document_expired: copy.DOCUMENT_ALREADY_EXPIRED,
      });
    }
  }

  async function transition(
    renterId: string,
    to: 'active' | 'offboarded',
    repaint: () => Promise<void>,
  ): Promise<void> {
    operatorStatus.textContent = copy.SAVING;
    try {
      await api.post(`/api/renters/${renterId}/transitions`, { to });
      operatorStatus.textContent =
        to === 'active' ? copy.RENTER_ACTIVATED : copy.RENTER_OFFBOARDED;
      await repaint();
      await loadRenters();
    } catch (error) {
      operatorStatus.textContent = messageFor(error, {
        documents_incomplete: copy.DOCUMENTS_INCOMPLETE,
        has_future_bookings: copy.GENERIC_ERROR,
      });
    }
  }

  // ---------- stations ----------

  async function loadStations(): Promise<void> {
    const answer = await api.get<StationsResponse>('/api/stations');
    today = answer.date;
    clear(stationsBody);
    for (const station of answer.stations) {
      const change = el('button', {
        class: 'btn',
        text: `Change settings for ${station.name}`,
        attrs: { type: 'button' },
      });
      change.addEventListener('click', () => openSettings(station, change));
      stationsBody.append(
        el('tr', {}, [
          el('td', { text: station.name, attrs: { 'data-label': 'Station' } }),
          el('td', { class: 'num', text: String(station.hour_weight), attrs: { 'data-label': 'Weight' } }),
          el('td', {
            class: 'num',
            text: String(station.off_peak_percent),
            attrs: { 'data-label': 'Off-peak %' },
          }),
          el('td', {
            class: 'num',
            text: `$${station.overage_usd_per_hour}`,
            attrs: { 'data-label': 'Overage/h' },
          }),
          el('td', {
            class: 'num',
            text: `${station.buffer_minutes} min`,
            attrs: { 'data-label': 'Buffer' },
          }),
          el('td', { attrs: { 'data-label': 'Settings' } }, [change]),
        ]),
      );
    }
  }

  function openSettings(station: Station, opener: HTMLElement): void {
    const effective = el('input', { attrs: { type: 'text', value: today } });
    const weight = el('input', { attrs: { type: 'text', value: String(station.hour_weight) } });
    const offPeak = el('input', { attrs: { type: 'text', value: String(station.off_peak_percent) } });
    const overage = el('input', { attrs: { type: 'text', value: station.overage_usd_per_hour } });
    const buffer = el('input', { attrs: { type: 'text', value: String(station.buffer_minutes) } });
    const entries = {
      effective_from: field('Effective from', effective, 'set-effective'),
      hour_weight: field('Hour weight', weight, 'set-weight'),
      off_peak_percent: field('Off-peak percent', offPeak, 'set-offpeak'),
      overage_usd_per_hour: field('Overage rate per hour', overage, 'set-overage'),
      buffer_minutes: field('Buffer minutes', buffer, 'set-buffer'),
    };
    const save = el('button', {
      class: 'btn btn--primary',
      text: 'Save settings',
      attrs: { type: 'button' },
    });

    const dialog = openDialog({
      label: 'Station settings',
      opener,
      body: [
        el('h2', { text: `Station settings \u00b7 ${station.name}` }),
        ...Object.values(entries).map((entry) => entry.wrapper),
        el('div', { class: 'dialog__actions' }, [save]),
      ],
    });

    save.addEventListener('click', () => {
      save.disabled = true;
      for (const entry of Object.values(entries)) setFieldError(entry.error, null);
      operatorStatus.textContent = copy.SAVING;
      void (async () => {
        try {
          const answer = await api.post<{ settings: { effective_from: string } }>(
            `/api/stations/${station.id}/settings`,
            {
              effective_from: effective.value.trim(),
              hour_weight: Number(weight.value.trim()),
              off_peak_percent: Number(offPeak.value.trim()),
              overage_usd_per_hour: overage.value.trim(),
              buffer_minutes: Number(buffer.value.trim()),
            },
          );
          dialog.close({ focus: null });
          operatorStatus.textContent = copy.settingsSaved(answer.settings.effective_from);
          await loadStations();
        } catch (error) {
          save.disabled = false;
          operatorStatus.textContent = '';
          if (error instanceof ApiError && error.status === 422) {
            for (const [key, message] of Object.entries(error.fieldErrors)) {
              const entry = entries[key as keyof typeof entries];
              if (entry) setFieldError(entry.error, message);
            }
          } else {
            operatorStatus.textContent = messageFor(error);
          }
        }
      })();
    });
  }

  // ---------- links ----------

  function linkState(link: ComplianceLink): string {
    if (link.revoked_at !== null) return 'Revoked';
    if (Date.parse(link.expires_at) <= serverNow()) return 'Expired';
    return `Live until ${stamp(link.expires_at)}`;
  }

  async function loadLinks(): Promise<void> {
    const answer = await api.get<{ links: ComplianceLink[] }>('/api/compliance-links');
    clear(linksList);
    if (answer.links.length === 0) {
      linksList.append(el('p', { class: 'empty', text: copy.EMPTY_LINKS }));
      return;
    }
    for (const link of answer.links) {
      const copied = el('span', { class: 'tag', attrs: { hidden: true }, text: copy.COPIED });
      const copyButton = el('button', {
        class: 'btn',
        text: `Copy link ${link.label}`,
        attrs: { type: 'button' },
      });
      copyButton.addEventListener('click', () => {
        const url = `${window.location.origin}${link.url}`;
        void navigator.clipboard?.writeText(url).catch(() => undefined);
        copied.hidden = false;
        window.setTimeout(() => {
          copied.hidden = true;
        }, 2_000);
      });
      const regenerate = el('button', {
        class: 'btn',
        text: `Regenerate ${link.label}`,
        attrs: { type: 'button' },
      });
      regenerate.addEventListener('click', () => void act(`/api/compliance-links/${link.id}/regenerate`, copy.LINK_REGENERATED));
      const revoke = el('button', {
        class: 'btn',
        text: `Revoke ${link.label}`,
        attrs: { type: 'button' },
      });
      revoke.addEventListener('click', () => void act(`/api/compliance-links/${link.id}/revoke`, copy.LINK_REVOKED));

      linksList.append(
        el('div', { class: 'docket__row' }, [
          el('p', {}, [
            el('strong', { text: link.label }),
            document.createTextNode(' \u00b7 '),
            el('span', { class: 'mono', text: linkState(link) }),
          ]),
          el('div', { class: 'rowbtns' }, [copyButton, regenerate, revoke, copied]),
        ]),
      );
    }
  }

  async function act(path: string, success: string): Promise<void> {
    operatorStatus.textContent = copy.SAVING;
    try {
      await api.post(path);
      operatorStatus.textContent = success;
      await loadLinks();
    } catch (error) {
      operatorStatus.textContent = messageFor(error);
      await loadLinks();
    }
  }

  const linkForm = context.root.querySelector<HTMLFormElement>('#link-form');
  linkForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    createLink.disabled = true;
    setFieldError(linkLabelField.error, null);
    operatorStatus.textContent = copy.SAVING;
    void (async () => {
      try {
        const answer = await api.post<{ link: ComplianceLink }>('/api/compliance-links', {
          label: linkLabel.value.trim(),
          expires_in_seconds: Number(linkExpiry.value),
        });
        operatorStatus.textContent = copy.linkCreated(stamp(answer.link.expires_at));
        linkLabel.value = '';
        await loadLinks();
      } catch (error) {
        operatorStatus.textContent = '';
        if (error instanceof ApiError && error.status === 422) {
          setFieldError(linkLabelField.error, error.fieldErrors['label'] ?? copy.GENERIC_ERROR);
        } else {
          operatorStatus.textContent = messageFor(error);
        }
      } finally {
        createLink.disabled = false;
      }
    })();
  });

  // ---------- notifications ----------

  async function loadNotifications(): Promise<void> {
    const answer = await api.get<{ notifications: Notification[] }>('/api/notifications');
    clear(notificationsBody);
    for (const notification of answer.notifications) {
      notificationsBody.append(
        el('tr', {}, [
          el('td', { text: notification.kind, attrs: { 'data-label': 'Kind' } }),
          el('td', { text: notification.to, attrs: { 'data-label': 'To' } }),
          el('td', { text: notification.subject, attrs: { 'data-label': 'Subject' } }),
          el('td', { attrs: { 'data-label': 'Status' } }, [
            el('span', { class: 'tag', text: notification.status === 'sent' ? 'Sent' : 'Queued' }),
          ]),
          el('td', {
            class: 'num',
            text: String(notification.attempts),
            attrs: { 'data-label': 'Attempts' },
          }),
        ]),
      );
    }
  }

  inBackground(async () => {
    await loadStations();
    await Promise.all([loadRenters(), loadLinks(), loadNotifications()]);
    heading.focus();
  });

  return () => undefined;
}
