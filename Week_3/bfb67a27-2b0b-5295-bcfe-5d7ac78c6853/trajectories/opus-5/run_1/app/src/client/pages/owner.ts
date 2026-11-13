import { formatDollars, formatMoney } from '../../shared/money.js';
import { apiGet, apiSend, ApiFailure } from '../api.js';
import { COPY, DESK_STATUS } from '../copy.js';
import { openDialog } from '../dialog.js';
import { clear, el, svgIcon } from '../dom.js';
import { mountServiceNotice } from '../notice.js';
import { signOutButton } from './desk.js';
import type {
  CertificateQueueItem,
  KitView,
  RateCardView,
  UnitHistoryView,
  UtilisationView,
} from '../../shared/types.js';

interface UnitRow {
  serial: string;
  classId: string;
  location: string;
}

export async function renderOwnerDesk(root: HTMLElement): Promise<void> {
  clear(root);
  let role: string;
  try {
    role = (await apiGet<{ role: string }>('/api/session')).role;
  } catch {
    window.location.assign('/desk');
    return;
  }

  const page = el('div', { class: 'page page-owner' });
  root.append(page);
  mountServiceNotice(page);

  if (role !== 'owner') {
    page.append(
      el('div', { class: 'sheet' }, [
        el('h1', { class: 'kit-name' }, [COPY.ownerOnlyHeading]),
        el('p', {}, ['Ask the owner to sign in on this desk.']),
      ]),
      el('header', { class: 'desk-header' }, [signOutButton()]),
    );
    return;
  }

  const status = el('div', { role: 'status', 'aria-label': 'Desk status', class: 'counter-status' });
  const utilisationRegion = el('section', { 'aria-label': 'Utilisation', class: 'desk-region', id: 'utilisation' });
  const kitsRegion = el('section', { 'aria-label': 'Kits', class: 'desk-region', id: 'kits' });
  const certificatesRegion = el('section', {
    'aria-label': 'Certificates to review',
    class: 'desk-region',
    id: 'certificates',
  });
  const rateCardsRegion = el('section', { 'aria-label': 'Rate cards', class: 'desk-region', id: 'rate-cards' });
  const unitsRegion = el('section', { 'aria-label': 'Units', class: 'desk-region', id: 'units' });

  const announce = (message: string): void => {
    status.textContent = message;
  };

  const reportFailure = (error: unknown, target?: HTMLElement): void => {
    if (!(error instanceof ApiFailure)) throw error;
    const message = error.controlMessage();
    if (target !== undefined) target.textContent = message;
    announce(message);
  };

  const renderUtilisation = (utilisation: UtilisationView): void => {
    clear(utilisationRegion);
    utilisationRegion.append(
      el('h2', { class: 'region-heading' }, ['Utilisation']),
      el('div', { class: 'utilisation-figures' }, [
        el('p', { class: 'numerals-small' }, [
          `${utilisation.out} of ${utilisation.totalUnits} units out`,
        ]),
        el('p', { class: 'numerals-small' }, [`${utilisation.onShelf} on the shelf`]),
        el('p', { class: 'numerals-small' }, [`${utilisation.repair} in repair`]),
        el('p', { class: 'numerals' }, [`${utilisation.utilisationPercent}% utilisation`]),
      ]),
    );
  };

  const renderKits = (kits: KitView[]): void => {
    clear(kitsRegion);
    kitsRegion.append(
      el('h2', { class: 'region-heading' }, ['Kits']),
      el(
        'ul',
        { class: 'kit-ready-list' },
        kits.map((kit) =>
          el('li', {}, [
            el('span', {}, [kit.name]),
            el('span', { class: 'numerals-small' }, [`${kit.readyToGo} ready to go`]),
          ]),
        ),
      ),
    );
  };

  const renderCertificates = (certificates: CertificateQueueItem[]): void => {
    clear(certificatesRegion);
    certificatesRegion.append(el('h2', { class: 'region-heading' }, ['Certificates to review']));
    const list = el('ul', { class: 'certificate-list' });
    for (const certificate of certificates) {
      const button = el('button', { type: 'button', class: 'button' }, [
        `Review ${certificate.bookingRef}`,
      ]);
      button.addEventListener('click', () => openReviewDialog(certificate));
      list.append(
        el('li', {}, [
          el('span', {}, [`${certificate.bookingRef} · ${certificate.sizeBytes} bytes`]),
          button,
        ]),
      );
    }
    certificatesRegion.append(list);
  };

  const openReviewDialog = (certificate: CertificateQueueItem): void => {
    openDialog('Review certificate', (close) => {
      const coverStart = el('input', { type: 'text', class: 'text-field', placeholder: 'YYYY-MM-DD' });
      const coverEnd = el('input', { type: 'text', class: 'text-field', placeholder: 'YYYY-MM-DD' });
      const limit = el('input', { type: 'text', class: 'text-field', inputmode: 'decimal' });
      const lossPayee = el('input', { type: 'checkbox' });
      const reason = el('input', { type: 'text', class: 'text-field' });
      const error = el('p', { class: 'field-error' });
      const approve = el('button', { type: 'button', class: 'button button-primary' }, ['Approve']);
      const reject = el('button', { type: 'button', class: 'button' }, ['Reject']);

      const review = async (body: Record<string, unknown>, approved: boolean): Promise<void> => {
        try {
          await apiSend(
            'POST',
            `/api/certificates/${certificate.id}/review`,
            body,
          );
          close();
          await refresh();
          announce(
            approved
              ? DESK_STATUS.certificateApproved(certificate.bookingRef)
              : DESK_STATUS.certificateRejected(certificate.bookingRef),
          );
        } catch (failure) {
          reportFailure(failure, error);
        }
      };

      approve.addEventListener('click', () => {
        void review(
          {
            decision: 'approve',
            coverageStart: coverStart.value.trim(),
            coverageEnd: coverEnd.value.trim(),
            limitCents: Math.round(Number(limit.value) * 100),
            lossPayeeNamed: lossPayee.checked,
          },
          true,
        );
      });
      reject.addEventListener('click', () => {
        void review({ decision: 'reject', reason: reason.value }, false);
      });

      return [
        el('h2', { class: 'dialog-heading' }, ['Review certificate']),
        el('a', { href: `/api/certificates/${certificate.id}/file`, target: '_blank', rel: 'noopener' }, [
          'Open certificate PDF',
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['Cover starts']),
          coverStart,
        ]),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['Cover ends']),
          coverEnd,
        ]),
        el('label', { class: 'field' }, [el('span', { class: 'field-label' }, ['Limit']), limit]),
        el('label', { class: 'check-field' }, [
          lossPayee,
          el('span', {}, ['Names Northbar Camera Hire as loss payee']),
        ]),
        error,
        approve,
        el('label', { class: 'field' }, [el('span', { class: 'field-label' }, ['Reason']), reason]),
        reject,
      ];
    });
  };

  const renderRateCards = (
    cards: { activeVersion: number; rateCards: RateCardView[] },
    kits: KitView[],
  ): void => {
    clear(rateCardsRegion);
    const publish = el('button', { type: 'button', class: 'button button-primary' }, [
      'Publish rate card',
    ]);
    publish.addEventListener('click', () => openPublishDialog(kits));
    rateCardsRegion.append(
      el('h2', { class: 'region-heading' }, ['Rate cards']),
      el('table', { class: 'unit-table' }, [
        el('caption', {}, ['Rate card versions']),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col' }, ['Version']),
            el('th', { scope: 'col' }, ['Effective date']),
            el('th', { scope: 'col' }, ['Rates']),
          ]),
        ]),
        el(
          'tbody',
          {},
          cards.rateCards.map((card) =>
            el('tr', { class: card.version === cards.activeVersion ? 'active-card' : '' }, [
              el('td', {}, [`v${card.version}`]),
              el('td', {}, [card.effectiveDate]),
              el('td', {}, [
                card.rates
                  .map((rate) => `${rate.kitId} ${formatMoney(rate.dayRateCents)}`)
                  .join(' · '),
              ]),
            ]),
          ),
        ),
      ]),
      publish,
    );
  };

  const openPublishDialog = (kits: KitView[]): void => {
    openDialog('Publish rate card', (close) => {
      const effective = el('input', { type: 'text', class: 'text-field', placeholder: 'YYYY-MM-DD' });
      const error = el('p', { class: 'field-error' });
      const inputs = kits.map((kit) => {
        const dayRate = el('input', {
          type: 'text',
          class: 'text-field',
          inputmode: 'decimal',
          value: formatDollars(kit.dayRateCents),
        });
        const deposit = el('input', {
          type: 'text',
          class: 'text-field',
          inputmode: 'decimal',
          value: formatDollars(kit.depositCents),
        });
        return { kit, dayRate, deposit };
      });
      const publish = el('button', { type: 'button', class: 'button button-primary' }, ['Publish']);
      publish.addEventListener('click', () => {
        void (async () => {
          try {
            const card = await apiSend<RateCardView>('POST', '/api/rate-cards', {
              effectiveDate: effective.value.trim(),
              rates: inputs.map((entry) => ({
                kitId: entry.kit.id,
                dayRateCents: Math.round(Number(entry.dayRate.value.replace(/,/g, '')) * 100),
                depositCents: Math.round(Number(entry.deposit.value.replace(/,/g, '')) * 100),
              })),
            });
            close();
            await refresh();
            announce(DESK_STATUS.rateCardPublished(card.version, card.effectiveDate));
          } catch (failure) {
            reportFailure(failure, error);
          }
        })();
      });

      const fields: Node[] = [
        el('h2', { class: 'dialog-heading' }, ['Publish rate card']),
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label' }, ['Effective date']),
          effective,
        ]),
      ];
      for (const entry of inputs) {
        fields.push(
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label' }, [`${entry.kit.name} day rate`]),
            entry.dayRate,
          ]),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label' }, [`${entry.kit.name} deposit`]),
            entry.deposit,
          ]),
        );
      }
      fields.push(error, el('div', { class: 'dialog-actions' }, [publish]));
      return fields;
    });
  };

  const renderUnits = (units: UnitRow[]): void => {
    clear(unitsRegion);
    const rows = units.map((unit) => {
      const history = el('button', { type: 'button', class: 'button button-small' }, [
        `History ${unit.serial}`,
      ]);
      history.addEventListener('click', () => void openHistoryDialog(unit.serial));
      const actions: Node[] = [history];
      if (unit.location === 'shelf') {
        const send = el('button', { type: 'button', class: 'button button-small' }, [
          `Send ${unit.serial} to repair`,
        ]);
        send.addEventListener('click', () => void move(unit.serial, 'repair'));
        actions.push(send);
      }
      if (unit.location === 'repair') {
        const back = el('button', { type: 'button', class: 'button button-small' }, [
          `Return ${unit.serial} from repair`,
        ]);
        back.addEventListener('click', () => void move(unit.serial, 'shelf'));
        actions.push(back);
      }
      const place: (Node | string)[] =
        unit.location === 'repair'
          ? [svgIcon('wrench', 18), el('span', {}, [unit.location])]
          : [unit.location];
      return el('tr', {}, [
        el('td', {}, [unit.serial]),
        el('td', {}, [unit.classId]),
        el('td', { class: 'location-cell' }, place),
        el('td', {}, actions),
      ]);
    });
    unitsRegion.append(
      el('h2', { class: 'region-heading' }, ['Units']),
      el('table', { class: 'unit-table' }, [
        el('caption', {}, ['Serial units']),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col' }, ['Serial']),
            el('th', { scope: 'col' }, ['Class']),
            el('th', { scope: 'col' }, ['Location']),
            el('th', { scope: 'col' }, ['Actions']),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    );
  };

  const move = async (serial: string, to: 'shelf' | 'repair'): Promise<void> => {
    try {
      await apiSend('POST', `/api/units/${serial}/moves`, { to });
      await refresh();
      announce(to === 'repair' ? DESK_STATUS.sentToRepair(serial) : DESK_STATUS.backOnShelf(serial));
    } catch (failure) {
      reportFailure(failure);
    }
  };

  const openHistoryDialog = async (serial: string): Promise<void> => {
    const history = await apiGet<UnitHistoryView>(`/api/units/${serial}/history`);
    openDialog(`Unit history ${serial}`, (close) => {
      const done = el('button', { type: 'button', class: 'button' }, ['Close']);
      done.addEventListener('click', close);
      return [
        el('h2', { class: 'dialog-heading' }, [`Unit history ${serial}`]),
        el('p', {}, [`Now at ${history.location}`]),
        el(
          'ul',
          { class: 'history-list' },
          history.movements.map((movement) =>
            el('li', {}, [
              `${movement.at} · ${movement.reason} · ${movement.from} → ${movement.to}${
                movement.bookingRef === null ? '' : ` · ${movement.bookingRef}`
              }`,
            ]),
          ),
        ),
        el('p', {}, [
          `Balances: ${Object.entries(history.balances)
            .map(([location, sum]) => `${location} ${sum > 0 ? '+' : ''}${sum}`)
            .join(', ')}`,
        ]),
        done,
      ];
    });
  };

  const refresh = async (): Promise<void> => {
    const [utilisation, kits, certificates, cards] = await Promise.all([
      apiGet<UtilisationView>('/api/utilisation'),
      apiGet<{ kits: KitView[] }>('/api/kits'),
      apiGet<{ certificates: CertificateQueueItem[] }>('/api/certificates?status=pending_review'),
      apiGet<{ activeVersion: number; rateCards: RateCardView[] }>('/api/rate-cards'),
    ]);
    const units: UnitRow[] = [];
    for (const kit of kits.kits) {
      const detail = await apiGet<{ units: UnitRow[] }>(`/api/kits/${kit.id}`);
      units.push(...detail.units);
    }
    renderUtilisation(utilisation);
    renderKits(kits.kits);
    renderCertificates(certificates.certificates);
    renderRateCards(cards, kits.kits);
    renderUnits(units);
  };

  page.append(
    el('header', { class: 'desk-header' }, [
      el('h1', { class: 'kit-name' }, ['Owner desk']),
      el('nav', { class: 'desk-links' }, [el('a', { href: '/desk/counter' }, ['Counter'])]),
      signOutButton(),
    ]),
    status,
    el('div', { class: 'owner-body' }, [
      el('nav', { 'aria-label': 'Desk sections', class: 'category-rail' }, [
        el('a', { class: 'category-link', href: '#utilisation' }, ['Utilisation']),
        el('a', { class: 'category-link', href: '#certificates' }, ['Certificates']),
        el('a', { class: 'category-link', href: '#rate-cards' }, ['Rate cards']),
        el('a', { class: 'category-link', href: '#units' }, ['Units']),
      ]),
      el('div', { class: 'desk-main' }, [
        utilisationRegion,
        kitsRegion,
        certificatesRegion,
        rateCardsRegion,
        unitsRegion,
      ]),
    ]),
  );

  await refresh();
}
