import { COUNTRIES_BY_NAME, ZONE_NAMES } from '../../shared/countries.js';
import { closedHeading, FIELD_COPY, PLEDGE_RESULT } from '../../shared/copy.js';
import { formatMoney, formatPence, parsePoundsToPence } from '../../shared/money.js';
import type {
  CampaignDto,
  PledgeDto,
  PledgeResultDto,
  QuoteDto,
  TierDto,
} from '../../shared/types.js';
import { ApiFailure, get, newIdempotencyKey, patch, post } from '../api.js';
import { clear, el, setChildren } from '../dom.js';
import { heldKey, holdKey } from '../session.js';
import { forgetViewer, viewer } from '../viewer.js';
import { openDialog } from '../ui/dialog.js';
import { announce, announceText, statusRegion } from '../ui/live.js';
import {
  Countdown,
  coverCircle,
  coverFull,
  fieldError,
  loadingStatus,
  stateMark,
} from '../ui/parts.js';
import { countUp, PlateFill } from '../ui/plateFill.js';
import { renderNotFound } from './notFound.js';

const REFRESH_MS = 30_000;
const QUOTE_DEBOUNCE_MS = 120;
const MAX_ADD_ON = 50_000;
const PINNED_FROM = 1200;
const PIN_GAP = 16;

interface Draft {
  tierId: string | null;
  country: string;
  addOnText: string;
}

interface ConfirmFields {
  readonly nameField: HTMLInputElement;
  readonly emailField: HTMLInputElement;
  readonly cardField: HTMLInputElement;
  readonly nameErrors: HTMLElement;
  readonly emailErrors: HTMLElement;
  readonly cardErrors: HTMLElement;
}

export function stockLabel(tier: TierDto): string {
  if (tier.quantity === null) return 'Open edition';
  if (tier.remaining !== null && tier.remaining <= 0) return 'Gone';
  return `${tier.remaining} of ${tier.quantity} left`;
}

/** One full-width inverted teal band of paper-coloured dots. */
export function bandOfDots(): HTMLElement {
  const band = el('div', { class: 'band', 'aria-hidden': 'true' });
  for (let index = 0; index < 160; index += 1) {
    band.appendChild(el('span', { class: 'band-dot' }));
  }
  return band;
}

function shippingRow(zone: string, pence: number): HTMLElement {
  return el(
    'tr',
    {},
    el('th', { scope: 'row' }, zone),
    el('td', { class: 'figures' }, formatMoney(pence)),
  );
}

function pledgeFailureCopy(error: ApiFailure): string {
  switch (error.code) {
    case 'tier_sold_out':
      return PLEDGE_RESULT.soldOut;
    case 'campaign_closed':
      return PLEDGE_RESULT.closed;
    case 'would_unfund':
      return PLEDGE_RESULT.wouldUnfund;
    default:
      return PLEDGE_RESULT.paymentsDown;
  }
}

/** A change or cancellation that fails leaves the pledge as it was. */
function unchangedFailureCopy(error: ApiFailure): string {
  switch (error.code) {
    case 'campaign_closed':
      return PLEDGE_RESULT.closed;
    case 'would_unfund':
      return PLEDGE_RESULT.wouldUnfund;
    case 'tier_sold_out':
      return PLEDGE_RESULT.soldOut;
    default:
      return PLEDGE_RESULT.paymentsDownUnchanged;
  }
}

class CampaignPage {
  private readonly host: HTMLElement;
  private readonly campaignId: string;
  private campaign: CampaignDto;
  private ownPledge: PledgeDto | null = null;
  private isCreator = false;
  private quote: QuoteDto | null = null;
  private readonly gauge: PlateFill;
  private readonly countdown = new Countdown('Time left');
  private readonly pledgeResult = statusRegion('Pledge result', 'live live--result');
  private readonly previewRegion = statusRegion('Pledge preview', 'live live--preview');
  private readonly stage = el('div', { role: 'region', 'aria-label': 'Pledge', class: 'stage' });
  private readonly totalFigure = el('span', { class: 'figures total-figure' });
  private readonly goalLine = el('p', { class: 'goal-line' });
  private readonly tierList = el('ul', { class: 'tier-list', 'aria-label': 'Reward tiers' });
  private addOnErrors = el('div', { class: 'field-errors' });
  private stageSignature = '';
  private draft: Draft;
  private editing = false;
  private quoteTimer = 0;
  private refreshTimer = 0;
  private disposed = false;
  private coverId: string | null;
  private readonly sideInner = el('div', { class: 'campaign-side-inner' });
  private sideObserver: ResizeObserver | null = null;

  constructor(host: HTMLElement, campaign: CampaignDto) {
    this.host = host;
    this.campaignId = campaign.id;
    this.campaign = campaign;
    this.coverId = campaign.media.find((item) => item.kind === 'cover')?.id ?? null;
    this.draft = { tierId: null, country: campaign.ships_from, addOnText: '0.00' };
    this.gauge = new PlateFill(
      { total: campaign.total, goal: campaign.goal, stretch: campaign.stretch },
      this.gaugeLabel(),
    );
    this.gauge.root.classList.add('plate--campaign');
  }

  dispose(): void {
    this.disposed = true;
    this.sideObserver?.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.countdown.stop();
    window.clearInterval(this.refreshTimer);
    window.clearTimeout(this.quoteTimer);
  }

  async start(focusChange: boolean): Promise<void> {
    const person = await viewer();
    this.isCreator = person !== null && person.id === this.campaign.creator.id;
    await this.loadOwnPledge();
    this.build();
    if (focusChange) this.focusStageAction();
    this.refreshTimer = window.setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async loadOwnPledge(): Promise<void> {
    this.ownPledge = null;
    if (heldKey() === null) return;
    try {
      const pledges = await get<PledgeDto[]>('/api/me/pledges');
      this.ownPledge =
        pledges.find(
          (pledge) =>
            pledge.campaign_id === this.campaignId &&
            (pledge.state === 'authorised' ||
              pledge.state === 'captured' ||
              pledge.state === 'errored'),
        ) ?? null;
    } catch {
      forgetViewer();
    }
  }

  private gaugeLabel(): string {
    return `Plate Fill: ${this.campaign.percent}% of the minimum run`;
  }

  private build(): void {
    const campaign = this.campaign;
    this.totalFigure.textContent = formatMoney(campaign.total);

    const lead = el(
      'div',
      { class: 'campaign-lead' },
      coverCircle(this.coverId, campaign.title, 'cover--lead'),
      el(
        'div',
        { class: 'campaign-titles' },
        el('h1', { class: 'campaign-title' }, campaign.title),
        el('p', { class: 'campaign-creator' }, `by ${campaign.creator.name}`),
      ),
    );

    this.sideInner.replaceChildren(
      this.gauge.root,
      el(
        'div',
        { class: 'totals' },
        el('p', { class: 'totals-label' }, 'Pledged so far'),
        el('p', { class: 'totals-amount' }, this.totalFigure),
        this.goalLine,
      ),
      this.countdown.root,
      this.stage,
    );
    const side = el('div', { class: 'campaign-side' }, this.sideInner);

    const story = el(
      'div',
      { class: 'campaign-story' },
      ...campaign.story
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== '')
        .map((paragraph) => el('p', {}, paragraph)),
    );

    const tiers = el(
      'div',
      { class: 'campaign-tiers' },
      el('h2', { class: 'section-heading' }, 'Reward tiers'),
      this.tierList,
    );

    this.host.replaceChildren(
      el('article', { class: 'campaign' }, lead, side, story, bandOfDots(), tiers),
    );
    this.syncHeader();
    this.renderStage();
    this.renderTiers();
    this.watchPin();
  }

  /**
   * The pinned column scrolls with the page until its lower edge reaches the window,
   * then stays put, so the pledge stage stays fully visible.
   */
  private pin(): void {
    if (window.innerWidth < PINNED_FROM) {
      this.sideInner.style.top = '';
      return;
    }
    const slack = window.innerHeight - this.sideInner.offsetHeight - PIN_GAP;
    this.sideInner.style.top = `${Math.min(PIN_GAP, slack)}px`;
  }

  private watchPin(): void {
    this.pin();
    this.sideObserver?.disconnect();
    this.sideObserver = new ResizeObserver(() => this.pin());
    this.sideObserver.observe(this.sideInner);
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  private readonly onResize = (): void => this.pin();

  private syncHeader(): void {
    const campaign = this.campaign;
    this.gauge.setLabel(this.gaugeLabel());
    this.totalFigure.textContent = formatMoney(campaign.total);
    this.goalLine.textContent =
      `${campaign.percent}% of a ${formatMoney(campaign.goal)} goal for a ` +
      `${campaign.min_run_copies.toLocaleString('en-GB')}-copy minimum run`;
    this.countdown.set(campaign.seconds_left ?? 0, () => void this.refresh());
  }

  /** Open, closed and time-left status come from the server's answer, never the device. */
  private async refresh(): Promise<void> {
    if (this.disposed) return;
    const previousTotal = this.campaign.total;
    let next: CampaignDto;
    try {
      next = await get<CampaignDto>(`/api/campaigns/${this.campaignId}`);
    } catch {
      return;
    }
    if (this.disposed) return;
    this.campaign = next;
    this.coverId = next.media.find((item) => item.kind === 'cover')?.id ?? null;
    if (!this.editing) await this.loadOwnPledge();
    if (this.disposed) return;
    if (next.total !== previousTotal) {
      void this.gauge.ink(next.total);
      void countUp(this.totalFigure, previousTotal, next.total, formatMoney);
    } else {
      this.gauge.setReading({ total: next.total, goal: next.goal, stretch: next.stretch });
    }
    this.syncHeader();
    this.renderStageIfChanged();
    this.renderTiers();
  }

  // --- The pledge stage ------------------------------------------------------

  /** What the stage shows depends only on these facts. */
  private signature(): string {
    const tiers = this.campaign.tiers
      .map((tier) => `${tier.id}:${tier.remaining ?? 'open'}`)
      .join(',');
    return [
      this.campaign.status,
      String(this.campaign.pledging_open),
      this.isCreator ? 'creator' : 'backer',
      `${this.ownPledge?.id ?? 'none'}:${this.ownPledge?.state ?? 'none'}`,
      String(this.editing),
      tiers,
    ].join('|');
  }

  private renderStageIfChanged(): void {
    const next = this.signature();
    if (next === this.stageSignature) return;
    const activeLabel = this.stage.contains(document.activeElement)
      ? ((document.activeElement as HTMLElement).textContent ?? '')
      : null;
    this.renderStage();
    if (activeLabel === null || activeLabel === '') return;
    const match = [...this.stage.querySelectorAll('button')].find(
      (button) => button.textContent === activeLabel,
    );
    match?.focus();
  }

  private renderStage(): void {
    this.stageSignature = this.signature();
    const campaign = this.campaign;
    const heading = closedHeading(campaign.status);
    if (heading !== null) {
      this.stage.replaceChildren(el('h2', { class: 'closed-heading' }, heading), this.pledgeResult);
      return;
    }
    if (!campaign.pledging_open) {
      this.stage.replaceChildren(
        el('h2', { class: 'closed-heading' }, PLEDGE_RESULT.closed),
        this.pledgeResult,
      );
      return;
    }
    if (this.isCreator) {
      this.stage.replaceChildren(
        el('h2', { class: 'stage-heading' }, 'Your campaign'),
        el('p', { class: 'stage-note' }, 'A creator cannot back their own run.'),
        this.pledgeResult,
      );
      return;
    }
    if (this.ownPledge !== null && !this.editing) {
      this.renderHeldPledge(this.ownPledge);
      return;
    }
    this.renderPledgeForm();
  }

  private renderHeldPledge(pledge: PledgeDto): void {
    const tier = this.campaign.tiers.find((item) => item.id === pledge.tier_id);
    const change = el('button', { type: 'button', class: 'button' }, 'Change pledge');
    const cancel = el('button', { type: 'button', class: 'button button--quiet' }, 'Cancel pledge');

    setChildren(
      this.stage,
      el('h2', { class: 'stage-heading' }, 'Your pledge'),
      el(
        'dl',
        { class: 'pledge-summary' },
        el('dt', {}, 'Reward'),
        el('dd', {}, tier?.title ?? ''),
        el('dt', {}, 'Amount'),
        el('dd', { class: 'figures' }, formatMoney(pledge.amount)),
        el('dt', {}, 'State'),
        el('dd', {}, stateMark(pledge.state)),
      ),
      pledge.state === 'authorised' ? el('div', { class: 'stage-actions' }, change, cancel) : null,
      this.pledgeResult,
    );

    change.addEventListener('click', () => {
      this.editing = true;
      this.draft = {
        tierId: pledge.tier_id,
        country: pledge.country,
        addOnText: formatPence(pledge.add_on),
      };
      this.renderStage();
    });
    cancel.addEventListener('click', () => this.openCancelDialog(cancel));
  }

  private renderPledgeForm(): void {
    const group = el(
      'fieldset',
      { class: 'tier-group', role: 'radiogroup', 'aria-labelledby': 'tier-group-legend' },
      el('legend', { class: 'tier-group-legend', id: 'tier-group-legend' }, 'Reward tier'),
      ...this.campaign.tiers.map((tier) => this.tierChoice(tier)),
    );

    const country = el('select', { 'aria-label': 'Shipping country', class: 'select' });
    for (const option of COUNTRIES_BY_NAME) {
      country.appendChild(el('option', { value: option.code }, option.name));
    }
    country.value = this.draft.country;

    const addOn = el('input', {
      type: 'text',
      class: 'input input--figures',
      inputmode: 'decimal',
      role: 'spinbutton',
      'aria-label': 'Add-on (£)',
      'aria-valuemin': '0',
      'aria-valuemax': '500',
      'aria-valuenow': String((parsePoundsToPence(this.draft.addOnText) ?? 0) / 100),
      value: this.draft.addOnText,
    });
    this.addOnErrors = el('div', { class: 'field-errors' });

    const review = el(
      'button',
      { type: 'button', class: 'button', disabled: this.draft.tierId === null },
      'Review pledge',
    );

    this.stage.replaceChildren(
      el('h2', { class: 'stage-heading' }, this.editing ? 'Change your pledge' : 'Back this run'),
      group,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Shipping country'), country),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field-label' }, 'Add-on (£)'),
        addOn,
        this.addOnErrors,
      ),
      this.previewRegion,
      el('div', { class: 'stage-actions' }, review),
      this.pledgeResult,
    );

    group.addEventListener('change', () => {
      const checked = group.querySelector<HTMLInputElement>('input[type=radio]:checked');
      this.draft.tierId = checked?.value ?? null;
      review.disabled = this.draft.tierId === null;
      this.requestQuote();
    });
    country.addEventListener('change', () => {
      this.draft.country = country.value;
      this.requestQuote();
    });

    const readAddOn = (): void => {
      this.draft.addOnText = addOn.value;
      addOn.setAttribute('aria-valuenow', String((parsePoundsToPence(addOn.value) ?? 0) / 100));
      this.requestQuote();
    };
    addOn.addEventListener('input', readAddOn);
    addOn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const current = parsePoundsToPence(addOn.value) ?? 0;
      const step = event.key === 'ArrowUp' ? 100 : -100;
      addOn.value = formatPence(Math.min(MAX_ADD_ON, Math.max(0, current + step)));
      readAddOn();
    });
    review.addEventListener('click', () => this.openConfirmDialog(review));

    if (this.draft.tierId !== null) this.requestQuote();
    else this.clearQuote();
  }

  private tierChoice(tier: TierDto): HTMLElement {
    const soldOut = tier.remaining !== null && tier.remaining <= 0;
    const titleId = `tier-title-${tier.id}`;
    return el(
      'label',
      { class: `tier-choice${soldOut ? ' is-gone' : ''}` },
      el('input', {
        type: 'radio',
        name: 'reward-tier',
        value: tier.id,
        class: 'tier-radio',
        'aria-labelledby': titleId,
        disabled: soldOut,
        checked: this.draft.tierId === tier.id,
      }),
      el(
        'span',
        { class: 'tier-choice-body' },
        el('span', { class: 'tier-choice-title', id: titleId }, tier.title),
        el('span', { class: 'tier-choice-price figures' }, formatMoney(tier.price)),
        el('span', { class: 'tier-choice-stock' }, stockLabel(tier)),
      ),
    );
  }

  // --- Quotes ----------------------------------------------------------------

  private clearQuote(): void {
    this.quote = null;
    this.gauge.clearProof();
    announce(this.previewRegion);
  }

  private requestQuote(): void {
    window.clearTimeout(this.quoteTimer);
    if (this.draft.tierId === null) {
      this.clearQuote();
      return;
    }
    this.quoteTimer = window.setTimeout(() => void this.fetchQuote(), QUOTE_DEBOUNCE_MS);
  }

  private async fetchQuote(): Promise<void> {
    const tierId = this.draft.tierId;
    if (tierId === null) return;
    const pence = parsePoundsToPence(this.draft.addOnText);
    if (pence === null || pence > MAX_ADD_ON) {
      this.addOnErrors.replaceChildren(fieldError(FIELD_COPY.add_on));
      this.clearQuote();
      return;
    }
    this.addOnErrors.replaceChildren();
    try {
      const quote = await post<QuoteDto>(`/api/campaigns/${this.campaignId}/quote`, {
        body: { tier_id: tierId, country: this.draft.country, add_on: pence },
      });
      if (this.disposed) return;
      this.quote = quote;
      this.gauge.showProof(quote.projected_total);
      announce(
        this.previewRegion,
        el('p', { class: 'preview-line' }, `Reward: ${formatMoney(quote.reward)}`),
        el(
          'p',
          { class: 'preview-line' },
          `Shipping (${ZONE_NAMES[quote.zone]}): ${formatMoney(quote.shipping)}`,
        ),
        el('p', { class: 'preview-line' }, `Add-on: ${formatMoney(quote.add_on)}`),
        el(
          'p',
          { class: 'preview-line preview-total' },
          `Pledge total: ${formatMoney(quote.amount)}`,
        ),
        el(
          'p',
          { class: 'preview-line' },
          `Your pledge would bring this to ${quote.projected_percent}%`,
        ),
      );
    } catch (error) {
      if (error instanceof ApiFailure && error.fields['add_on'] !== undefined) {
        this.addOnErrors.replaceChildren(fieldError(error.fields['add_on']));
      }
      this.clearQuote();
    }
  }

  // --- Dialogs ---------------------------------------------------------------

  private openConfirmDialog(opener: HTMLButtonElement): void {
    const quote = this.quote;
    if (quote === null) return;
    const changing = this.editing && this.ownPledge !== null;
    const title = changing ? 'Confirm change' : 'Confirm pledge';
    const needsDetails = heldKey() === null;

    const fields: ConfirmFields = {
      nameField: el('input', { type: 'text', 'aria-label': 'Name', class: 'input' }),
      emailField: el('input', { type: 'email', 'aria-label': 'Email', class: 'input' }),
      cardField: el('input', {
        type: 'text',
        'aria-label': 'Card number',
        class: 'input input--figures',
        inputmode: 'numeric',
        autocomplete: 'off',
      }),
      nameErrors: el('div', { class: 'field-errors' }),
      emailErrors: el('div', { class: 'field-errors' }),
      cardErrors: el('div', { class: 'field-errors' }),
    };

    const confirm = el('button', { type: 'button', class: 'button' }, title);
    const back = el('button', { type: 'button', class: 'button button--quiet' }, 'Back');
    const tier = this.campaign.tiers.find((item) => item.id === quote.tier_id);

    const body = el(
      'div',
      { class: 'dialog-body' },
      el('h2', { class: 'dialog-title' }, title),
      el(
        'dl',
        { class: 'pledge-summary' },
        el('dt', {}, 'Reward'),
        el('dd', {}, tier?.title ?? ''),
        el('dt', {}, `Shipping (${ZONE_NAMES[quote.zone]})`),
        el('dd', { class: 'figures' }, formatMoney(quote.shipping)),
        el('dt', {}, 'Add-on'),
        el('dd', { class: 'figures' }, formatMoney(quote.add_on)),
        el('dt', {}, 'Pledge total'),
        el('dd', { class: 'figures' }, formatMoney(quote.amount)),
      ),
      needsDetails && !changing
        ? el(
            'div',
            { class: 'dialog-fields' },
            el(
              'div',
              { class: 'field' },
              el('span', { class: 'field-label' }, 'Name'),
              fields.nameField,
              fields.nameErrors,
            ),
            el(
              'div',
              { class: 'field' },
              el('span', { class: 'field-label' }, 'Email'),
              fields.emailField,
              fields.emailErrors,
            ),
          )
        : null,
      changing
        ? null
        : el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label' }, 'Card number'),
            fields.cardField,
            fields.cardErrors,
          ),
      el('div', { class: 'dialog-actions' }, confirm, back),
    );

    let replacement: HTMLElement | null = null;
    const dialog = openDialog({
      name: title,
      body,
      initialFocus: () => (changing ? confirm : needsDetails ? fields.nameField : fields.cardField),
      returnFocus: () => replacement ?? opener,
    });

    const submit = (): void => {
      void (async () => {
        fields.nameErrors.replaceChildren();
        fields.emailErrors.replaceChildren();
        fields.cardErrors.replaceChildren();
        confirm.disabled = true;
        announceText(this.pledgeResult, PLEDGE_RESULT.pending(quote.amount));
        try {
          const result = changing
            ? await this.sendChange(quote)
            : await this.sendPledge(quote, fields);
          dialog.close();
          await this.afterPledge(result, changing);
          replacement = this.stageAction();
          replacement?.focus();
        } catch (error) {
          if (!(error instanceof ApiFailure)) throw error;
          confirm.disabled = false;
          this.gauge.clearProof();
          if (this.showFieldFailure(error, fields, changing)) return;
          announceText(
            this.pledgeResult,
            changing ? unchangedFailureCopy(error) : pledgeFailureCopy(error),
          );
          dialog.close();
          if (error.code === 'tier_sold_out' || error.code === 'campaign_closed') {
            await this.refresh();
          }
        }
      })();
    };

    confirm.addEventListener('click', submit);
    fields.cardField.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    back.addEventListener('click', () => dialog.close());
  }

  /** A declined card or a wrong field keeps the dialog open, with focus on the field. */
  private showFieldFailure(
    error: ApiFailure,
    fields: ConfirmFields,
    changing: boolean,
  ): boolean {
    if (error.status === 402) {
      announceText(this.pledgeResult, PLEDGE_RESULT.declined);
      fields.cardErrors.replaceChildren(fieldError(FIELD_COPY.card_number));
      fields.cardField.focus();
      return true;
    }
    if (error.status !== 422) return false;
    const order: readonly (readonly [string, HTMLElement, HTMLInputElement])[] = [
      ['name', fields.nameErrors, fields.nameField],
      ['email', fields.emailErrors, fields.emailField],
      ['card_number', fields.cardErrors, fields.cardField],
    ];
    let focused = false;
    for (const [field, host, input] of order) {
      const message = error.fields[field];
      if (message === undefined) continue;
      host.replaceChildren(fieldError(message));
      if (focused || (changing && field === 'card_number')) continue;
      input.focus();
      focused = true;
    }
    if (error.fields['add_on'] !== undefined) {
      this.addOnErrors.replaceChildren(fieldError(error.fields['add_on']));
    }
    return focused;
  }

  private async sendPledge(quote: QuoteDto, fields: ConfirmFields): Promise<PledgeResultDto> {
    const payload: Record<string, unknown> = {
      tier_id: quote.tier_id,
      country: this.draft.country,
      add_on: quote.add_on,
      card_number: fields.cardField.value.trim(),
    };
    if (heldKey() === null) {
      payload['name'] = fields.nameField.value.trim();
      payload['email'] = fields.emailField.value.trim();
    }
    const result = await post<PledgeResultDto & { key?: string }>(
      `/api/campaigns/${this.campaignId}/pledges`,
      { body: payload, idempotencyKey: newIdempotencyKey() },
    );
    if (typeof result.key === 'string') {
      holdKey(result.key);
      forgetViewer();
    }
    return result;
  }

  private async sendChange(quote: QuoteDto): Promise<PledgeResultDto> {
    const pledge = this.ownPledge as PledgeDto;
    return patch<PledgeResultDto>(`/api/pledges/${pledge.id}`, {
      body: { tier_id: quote.tier_id, country: this.draft.country, add_on: quote.add_on },
      idempotencyKey: newIdempotencyKey(),
    });
  }

  /** The rings ink and the total counts up, and only then is the result announced. */
  private async afterPledge(result: PledgeResultDto, changing: boolean): Promise<void> {
    const previousTotal = this.campaign.total;
    this.campaign = {
      ...this.campaign,
      total: result.campaign_total,
      percent: result.campaign_percent,
    };
    this.ownPledge = result;
    this.editing = false;
    this.quote = null;

    await Promise.all([
      this.gauge.ink(result.campaign_total),
      countUp(this.totalFigure, previousTotal, result.campaign_total, formatMoney),
    ]);
    this.syncHeader();
    this.renderStage();
    announceText(
      this.pledgeResult,
      changing ? PLEDGE_RESULT.changed(result.amount) : PLEDGE_RESULT.authorised(result.amount),
    );
    void this.refresh();
  }

  private openCancelDialog(opener: HTMLButtonElement): void {
    const pledge = this.ownPledge as PledgeDto;
    const release = el('button', { type: 'button', class: 'button' }, 'Yes, release my card');
    const keep = el('button', { type: 'button', class: 'button button--quiet' }, 'Keep pledge');
    const dialog = openDialog({
      name: 'Cancel pledge',
      body: el(
        'div',
        { class: 'dialog-body' },
        el('h2', { class: 'dialog-title' }, 'Cancel pledge'),
        el(
          'p',
          {},
          `This releases the hold of ${formatMoney(pledge.amount)} on your card and frees your copy.`,
        ),
        el('div', { class: 'dialog-actions' }, release, keep),
      ),
      initialFocus: () => release,
      returnFocus: () => opener,
    });

    keep.addEventListener('click', () => dialog.close());
    release.addEventListener('click', () => {
      void (async () => {
        release.disabled = true;
        try {
          await post<PledgeDto>(`/api/pledges/${pledge.id}/cancel`);
          dialog.close();
          this.ownPledge = null;
          this.editing = false;
          await this.refresh();
          announceText(this.pledgeResult, PLEDGE_RESULT.cancelled);
        } catch (error) {
          if (!(error instanceof ApiFailure)) throw error;
          dialog.close();
          announceText(this.pledgeResult, unchangedFailureCopy(error));
          await this.refresh();
        }
      })();
    });
  }

  private stageAction(): HTMLElement | null {
    return this.stage.querySelector<HTMLElement>('.stage-actions .button');
  }

  private focusStageAction(): void {
    this.stageAction()?.focus();
  }

  // --- Tier list -------------------------------------------------------------

  private renderTiers(): void {
    clear(this.tierList);
    for (const tier of this.campaign.tiers) {
      const panel = el(
        'div',
        { class: 'tier-panel', hidden: true },
        el('p', { class: 'tier-description' }, tier.description),
        el(
          'table',
          { class: 'shipping-table' },
          el('caption', { class: 'shipping-caption' }, `Shipping for ${tier.title}`),
          el(
            'tbody',
            {},
            shippingRow('Domestic', tier.shipping.domestic),
            shippingRow('Europe', tier.shipping.europe),
            shippingRow('Rest of world', tier.shipping.rest_of_world),
          ),
        ),
        coverFull(this.coverId, this.campaign.title),
      );
      const toggle = el(
        'button',
        { type: 'button', class: 'tier-toggle', 'aria-expanded': 'false' },
        `Open ${tier.title}`,
      );
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        panel.hidden = open;
      });
      this.tierList.appendChild(
        el(
          'li',
          { class: 'tier-item' },
          el(
            'div',
            { class: 'tier-item-head' },
            el('h3', { class: 'tier-item-title' }, tier.title),
            el('p', { class: 'tier-item-price figures' }, formatMoney(tier.price)),
            el('p', { class: 'tier-item-stock' }, stockLabel(tier)),
            toggle,
          ),
          panel,
        ),
      );
    }
  }
}

export function renderCampaign(main: HTMLElement, id: string, focusChange: boolean): () => void {
  const host = el('div', { class: 'page page--campaign' }, loadingStatus());
  main.replaceChildren(host);
  let page: CampaignPage | null = null;
  void (async () => {
    try {
      const campaign = await get<CampaignDto>(`/api/campaigns/${id}`);
      page = new CampaignPage(host, campaign);
      await page.start(focusChange);
    } catch (error) {
      if (error instanceof ApiFailure) {
        renderNotFound(main);
        return;
      }
      throw error;
    }
  })();
  return () => page?.dispose();
}
