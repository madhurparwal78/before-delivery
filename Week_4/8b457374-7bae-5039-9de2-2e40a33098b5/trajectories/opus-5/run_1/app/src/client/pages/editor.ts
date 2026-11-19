import { COUNTRIES_BY_NAME } from '../../shared/countries.js';
import { EMPTY_STATES, FIELD_COPY, STUDIO_RESULT } from '../../shared/copy.js';
import { formatMoney, formatPence, parsePoundsToPence } from '../../shared/money.js';
import type {
  CampaignDto,
  MediaDto,
  PledgeWithBackerDto,
  SettlementDto,
  TierDto,
} from '../../shared/types.js';
import { ApiFailure, del, downloadFile, get, patch, post } from '../api.js';
import { el } from '../dom.js';
import { heldKey } from '../session.js';
import { openDialog } from '../ui/dialog.js';
import { announceText, statusRegion } from '../ui/live.js';
import { coverCircle, emptyState, fieldError, loadingStatus, stateMark } from '../ui/parts.js';
import { PlateFill } from '../ui/plateFill.js';
import { renderNotFound } from './notFound.js';
import { navigate } from '../router.js';

const MAX_TIERS = 8;
const MAX_BREAK_POINTS = 3;

interface BreakPointRow {
  readonly copies: HTMLInputElement;
  readonly amount: HTMLInputElement;
  readonly errors: HTMLElement;
  readonly root: HTMLElement;
}

interface TierRow {
  id: string | null;
  readonly fields: {
    title: HTMLInputElement;
    description: HTMLTextAreaElement;
    price: HTMLInputElement;
    quantity: HTMLInputElement;
    domestic: HTMLInputElement;
    europe: HTMLInputElement;
    restOfWorld: HTMLInputElement;
  };
  readonly errors: HTMLElement;
  readonly legend: HTMLElement;
  readonly root: HTMLElement;
}

function field(
  labelText: string,
  control: HTMLElement,
  id: string,
  errors: HTMLElement,
  hint?: string,
): HTMLElement {
  control.setAttribute('id', id);
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, labelText),
    hint === undefined ? null : el('p', { class: 'field-hint' }, hint),
    control,
    errors,
  );
}

function textInput(label: string, value = ''): HTMLInputElement {
  return el('input', { type: 'text', class: 'input', 'aria-label': label, value });
}

function numberInput(label: string, value: string): HTMLInputElement {
  return el('input', {
    type: 'number',
    class: 'input input--figures',
    'aria-label': label,
    min: '0',
    step: '1',
    value,
  });
}

/** Every editor field ending in (£) takes pounds and converts exactly to pence. */
function poundsValue(input: HTMLInputElement, errors: HTMLElement): number | null {
  const pence = parsePoundsToPence(input.value);
  if (pence === null) {
    errors.replaceChildren(fieldError(FIELD_COPY.pounds));
    return null;
  }
  errors.replaceChildren();
  return pence;
}

class Editor {
  private readonly host: HTMLElement;
  private campaign: CampaignDto;
  private readonly result = statusRegion('Studio result', 'live live--result');
  private readonly checkRegion = el('div', {
    role: 'region',
    'aria-label': 'Check these fields',
    class: 'check-region',
    hidden: true,
  });
  private readonly fieldErrorHosts = new Map<string, HTMLElement>();
  private readonly breakPoints: BreakPointRow[] = [];
  private readonly tiers: TierRow[] = [];
  private readonly breakPointHost = el('div', { class: 'group-stack' });
  private readonly tierHost = el('div', { class: 'group-stack' });
  private readonly imageList = el('ul', { class: 'image-list', 'aria-label': 'Images' });
  private previewGauge: PlateFill | null = null;
  private previewCover = el('div', { class: 'preview-cover' });

  private title = textInput('Title');
  private story = el('textarea', { class: 'input input--area', 'aria-label': 'Story', rows: '8' });
  private goal = textInput('Goal (£)');
  private minRun = numberInput('Minimum run (copies)', '100');
  private shipsFrom = el('select', { class: 'select', 'aria-label': 'Ships from' });
  private timeZone = el('select', { class: 'select', 'aria-label': 'Time zone' });
  private deadline = textInput('Deadline');

  constructor(host: HTMLElement, campaign: CampaignDto) {
    this.host = host;
    this.campaign = campaign;
  }

  render(): void {
    const campaign = this.campaign;
    const draft = campaign.status === 'draft';

    for (const country of COUNTRIES_BY_NAME) {
      this.shipsFrom.appendChild(el('option', { value: country.code }, country.name));
    }
    const zones = Intl.supportedValuesOf('timeZone');
    // A campaign may hold a valid link name, such as UTC, that the list leaves out.
    if (!zones.includes(campaign.time_zone)) zones.unshift(campaign.time_zone);
    for (const zone of zones) {
      this.timeZone.appendChild(el('option', { value: zone }, zone));
    }

    this.title.value = campaign.title;
    this.story.value = campaign.story;
    this.goal.value = formatPence(campaign.goal);
    this.minRun.value = String(campaign.min_run_copies);
    this.shipsFrom.value = campaign.ships_from;
    this.timeZone.value = campaign.time_zone;
    this.deadline.value = campaign.deadline_local.slice(0, 16).replace('T', ' ');

    const saveDraft = el('button', { type: 'button', class: 'button' }, 'Save draft');
    const addBreakPoint = el(
      'button',
      { type: 'button', class: 'button button--quiet' },
      'Add break point',
    );
    const addTier = el('button', { type: 'button', class: 'button button--quiet' }, 'Add tier');
    const launch = el('button', { type: 'button', class: 'button' }, 'Launch campaign');

    const form = el(
      'div',
      { class: 'editor-form' },
      this.checkRegion,
      field('Title', this.title, 'editor-title', this.errorHost('title')),
      field('Story', this.story, 'editor-story', this.errorHost('story')),
      field('Goal (£)', this.goal, 'editor-goal', this.errorHost('goal')),
      field('Minimum run (copies)', this.minRun, 'editor-min-run', this.errorHost('min_run_copies')),
      field('Ships from', this.shipsFrom, 'editor-ships-from', this.errorHost('ships_from')),
      field('Time zone', this.timeZone, 'editor-time-zone', this.errorHost('time_zone')),
      field(
        'Deadline',
        this.deadline,
        'editor-deadline',
        this.errorHost('deadline_local'),
        'Local date and time, for example 2026-12-01 20:00',
      ),
      el('div', { class: 'editor-actions' }, saveDraft),
      el('h2', { class: 'section-heading' }, 'Stretch break points'),
      this.breakPointHost,
      el('div', { class: 'editor-actions' }, addBreakPoint),
      el('h2', { class: 'section-heading' }, 'Reward tiers'),
      this.errorHost('tiers'),
      this.tierHost,
      el('div', { class: 'editor-actions' }, addTier),
      el('h2', { class: 'section-heading' }, 'Images'),
      this.errorHost('cover'),
      this.errorHost('media'),
      this.mediaFields(),
      this.imageList,
      el('div', { class: 'editor-actions' }, draft ? launch : null, this.cancelButton()),
      this.result,
    );

    this.previewGauge = new PlateFill(
      { total: 0, goal: campaign.goal, stretch: campaign.stretch },
      'Plate Fill: 0%',
    );
    this.previewGauge.root.classList.add('plate--campaign');
    const preview = el(
      'aside',
      { class: 'editor-preview' },
      el('h2', { class: 'section-heading' }, 'Preview'),
      this.previewCover,
      this.previewGauge.root,
    );

    this.host.replaceChildren(
      el(
        'section',
        { class: 'page editor' },
        el('h1', { class: 'page-heading' }, 'Edit campaign'),
        el('div', { class: 'editor-grid' }, form, preview),
        this.studioPanels(),
      ),
    );

    for (const point of campaign.stretch) this.addBreakPoint(point.copies, point.amount);
    for (const tier of campaign.tiers) this.addTier(tier);
    this.renderImages(campaign.media);
    this.renderPreviewCover();

    for (const control of [this.title, this.goal, this.minRun, this.deadline, this.story]) {
      control.disabled = !draft;
    }
    this.shipsFrom.disabled = !draft;
    this.timeZone.disabled = !draft;
    saveDraft.disabled = !draft;
    addBreakPoint.disabled = !draft;
    addTier.disabled = !draft;

    saveDraft.addEventListener('click', () => void this.saveDraft());
    addBreakPoint.addEventListener('click', () => {
      if (this.breakPoints.length >= MAX_BREAK_POINTS) return;
      this.addBreakPoint(null, null);
    });
    addTier.addEventListener('click', () => {
      if (this.tiers.length >= MAX_TIERS) return;
      this.addTier(null);
    });
    launch.addEventListener('click', () => void this.launch());
  }

  private errorHost(name: string): HTMLElement {
    const existing = this.fieldErrorHosts.get(name);
    if (existing !== undefined) return existing;
    const host = el('div', { class: 'field-errors' });
    this.fieldErrorHosts.set(name, host);
    return host;
  }

  private cancelButton(): HTMLElement | null {
    if (this.campaign.status !== 'live') return null;
    const cancel = el(
      'button',
      { type: 'button', class: 'button button--quiet' },
      'Cancel campaign',
    );
    cancel.addEventListener('click', () => {
      const release = el('button', { type: 'button', class: 'button' }, 'Yes, release every card');
      const keep = el('button', { type: 'button', class: 'button button--quiet' }, 'Keep campaign');
      const dialog = openDialog({
        name: 'Cancel campaign',
        body: el(
          'div',
          { class: 'dialog-body' },
          el('h2', { class: 'dialog-title' }, 'Cancel campaign'),
          el('p', {}, 'Every held card is released and no card is charged.'),
          el('div', { class: 'dialog-actions' }, release, keep),
        ),
        initialFocus: () => release,
        returnFocus: () => cancel,
      });
      keep.addEventListener('click', () => dialog.close());
      release.addEventListener('click', () => {
        void (async () => {
          release.disabled = true;
          try {
            await post<CampaignDto>(`/api/campaigns/${this.campaign.id}/cancel`);
            dialog.close();
            announceText(this.result, STUDIO_RESULT.cancelled);
            await this.reload();
          } catch (error) {
            dialog.close();
            announceText(this.result, outageCopy(error));
          }
        })();
      });
    });
    return cancel;
  }

  private mediaFields(): HTMLElement {
    const cover = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    const spreads = el('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp',
      multiple: true,
    });
    cover.disabled = this.campaign.status !== 'draft';
    spreads.disabled = this.campaign.status !== 'draft';
    cover.addEventListener('change', () => void this.uploadFiles(cover, 'cover'));
    spreads.addEventListener('change', () => void this.uploadFiles(spreads, 'spread'));
    return el(
      'div',
      { class: 'media-fields' },
      field('Cover art', cover, 'editor-cover', el('div', { class: 'field-errors' })),
      field('Spread previews', spreads, 'editor-spreads', el('div', { class: 'field-errors' })),
    );
  }

  // --- Draft fields ----------------------------------------------------------

  private clearFieldErrors(): void {
    for (const host of this.fieldErrorHosts.values()) host.replaceChildren();
    this.checkRegion.replaceChildren();
    this.checkRegion.hidden = true;
  }

  private showFieldErrors(fields: Record<string, string>): void {
    const links: HTMLElement[] = [];
    for (const [name, message] of Object.entries(fields)) {
      this.errorHost(name).replaceChildren(fieldError(message));
      const target = FIELD_IDS[name];
      if (target !== undefined) {
        links.push(el('li', {}, el('a', { href: `#${target}` }, message)));
      }
    }
    if (links.length > 0) {
      this.checkRegion.replaceChildren(
        el('h2', { class: 'check-heading' }, 'Check these fields'),
        el('ul', { class: 'check-list' }, ...links),
      );
      this.checkRegion.hidden = false;
    }
    announceText(this.result, STUDIO_RESULT.validation);
  }

  private draftBody(): Record<string, unknown> | null {
    this.clearFieldErrors();
    const goal = poundsValue(this.goal, this.errorHost('goal'));
    const stretch: { copies: number; amount: number }[] = [];
    let ok = goal !== null;
    for (const point of this.breakPoints) {
      const amount = poundsValue(point.amount, point.errors);
      const copies = Number(point.copies.value);
      if (amount === null || !Number.isSafeInteger(copies)) {
        ok = false;
        continue;
      }
      stretch.push({ copies, amount });
    }
    if (!ok) {
      announceText(this.result, STUDIO_RESULT.validation);
      return null;
    }
    return {
      title: this.title.value,
      story: this.story.value,
      goal,
      min_run_copies: Number(this.minRun.value),
      stretch,
      ships_from: this.shipsFrom.value,
      time_zone: this.timeZone.value,
      deadline_local: this.deadline.value.trim().replace(' ', 'T'),
    };
  }

  private async saveDraft(): Promise<void> {
    const body = this.draftBody();
    if (body === null) return;
    announceText(this.result, STUDIO_RESULT.savingDraft);
    try {
      this.campaign = await patch<CampaignDto>(`/api/campaigns/${this.campaign.id}`, { body });
      announceText(this.result, STUDIO_RESULT.draftSaved);
      this.refreshPreview();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        this.showFieldErrors(error.fields);
        return;
      }
      announceText(this.result, outageCopy(error));
    }
  }

  private addBreakPoint(copies: number | null, amount: number | null): void {
    const index = this.breakPoints.length + 1;
    const copiesInput = numberInput('Copies', copies === null ? '' : String(copies));
    const amountInput = textInput('Amount (£)', amount === null ? '' : formatPence(amount));
    const errors = el('div', { class: 'field-errors' });
    const root = el(
      'fieldset',
      { class: 'group' },
      el('legend', {}, `Break point ${index}`),
      field('Copies', copiesInput, `break-copies-${index}`, el('div', { class: 'field-errors' })),
      field('Amount (£)', amountInput, `break-amount-${index}`, errors),
    );
    copiesInput.disabled = this.campaign.status !== 'draft';
    amountInput.disabled = this.campaign.status !== 'draft';
    this.breakPoints.push({ copies: copiesInput, amount: amountInput, errors, root });
    this.breakPointHost.appendChild(root);
  }

  // --- Tiers -----------------------------------------------------------------

  private addTier(tier: TierDto | null): void {
    const index = this.tiers.length + 1;
    const draft = this.campaign.status === 'draft';
    const fields = {
      title: textInput('Tier title', tier?.title ?? ''),
      description: el('textarea', {
        class: 'input input--area',
        'aria-label': 'Description',
        rows: '3',
      }),
      price: textInput('Price (£)', tier === null ? '' : formatPence(tier.price)),
      quantity: numberInput(
        'Copies available',
        tier?.quantity === null || tier === null ? '' : String(tier.quantity),
      ),
      domestic: textInput(
        'Domestic shipping (£)',
        tier === null ? '' : formatPence(tier.shipping.domestic),
      ),
      europe: textInput(
        'Europe shipping (£)',
        tier === null ? '' : formatPence(tier.shipping.europe),
      ),
      restOfWorld: textInput(
        'Rest of world shipping (£)',
        tier === null ? '' : formatPence(tier.shipping.rest_of_world),
      ),
    };
    fields.description.value = tier?.description ?? '';

    const errors = el('div', { class: 'field-errors' });
    const save = el('button', { type: 'button', class: 'button' }, 'Save tier');
    const remove = el('button', { type: 'button', class: 'button button--quiet' }, 'Remove tier');
    const legend = el('legend', {}, `Tier ${index}`);
    const root = el(
      'fieldset',
      { class: 'group' },
      legend,
      field('Tier title', fields.title, `tier-title-${index}`, el('div', { class: 'field-errors' })),
      field(
        'Description',
        fields.description,
        `tier-description-${index}`,
        el('div', { class: 'field-errors' }),
      ),
      field('Price (£)', fields.price, `tier-price-${index}`, el('div', { class: 'field-errors' })),
      field(
        'Copies available',
        fields.quantity,
        `tier-quantity-${index}`,
        el('div', { class: 'field-errors' }),
        'Leave blank for an open edition',
      ),
      field(
        'Domestic shipping (£)',
        fields.domestic,
        `tier-domestic-${index}`,
        el('div', { class: 'field-errors' }),
      ),
      field(
        'Europe shipping (£)',
        fields.europe,
        `tier-europe-${index}`,
        el('div', { class: 'field-errors' }),
      ),
      field(
        'Rest of world shipping (£)',
        fields.restOfWorld,
        `tier-row-${index}`,
        el('div', { class: 'field-errors' }),
      ),
      errors,
      el('div', { class: 'editor-actions' }, save, remove),
    );

    for (const control of Object.values(fields)) control.disabled = !draft;
    save.disabled = !draft;
    remove.disabled = !draft;

    const row: TierRow = { id: tier?.id ?? null, fields, errors, legend, root };
    this.tiers.push(row);
    this.tierHost.appendChild(root);

    save.addEventListener('click', () => void this.saveTier(row));
    remove.addEventListener('click', () => void this.removeTier(row));
  }

  private tierBody(row: TierRow): Record<string, unknown> | null {
    row.errors.replaceChildren();
    const price = parsePoundsToPence(row.fields.price.value);
    const domestic = parsePoundsToPence(row.fields.domestic.value);
    const europe = parsePoundsToPence(row.fields.europe.value);
    const restOfWorld = parsePoundsToPence(row.fields.restOfWorld.value);
    if (price === null || domestic === null || europe === null || restOfWorld === null) {
      row.errors.replaceChildren(fieldError(FIELD_COPY.pounds));
      announceText(this.result, STUDIO_RESULT.validation);
      return null;
    }
    const quantityText = row.fields.quantity.value.trim();
    return {
      title: row.fields.title.value,
      description: row.fields.description.value,
      price,
      quantity: quantityText === '' ? null : Number(quantityText),
      shipping: { domestic, europe, rest_of_world: restOfWorld },
    };
  }

  private async saveTier(row: TierRow): Promise<void> {
    const body = this.tierBody(row);
    if (body === null) return;
    try {
      const saved =
        row.id === null
          ? await post<TierDto>(`/api/campaigns/${this.campaign.id}/tiers`, { body })
          : await patch<TierDto>(`/api/tiers/${row.id}`, { body });
      row.id = saved.id;
      announceText(this.result, STUDIO_RESULT.tierSaved);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 422) {
        row.errors.replaceChildren(
          ...Object.values(error.fields).map((message) => fieldError(message)),
        );
        announceText(this.result, STUDIO_RESULT.validation);
        return;
      }
      announceText(this.result, outageCopy(error));
    }
  }

  private async removeTier(row: TierRow): Promise<void> {
    if (row.id !== null) {
      try {
        await del(`/api/tiers/${row.id}`);
      } catch (error) {
        announceText(this.result, outageCopy(error));
        return;
      }
    }
    row.root.remove();
    const position = this.tiers.indexOf(row);
    if (position >= 0) this.tiers.splice(position, 1);
    this.tiers.forEach((item, index) => {
      item.legend.textContent = `Tier ${index + 1}`;
    });
  }

  // --- Images ----------------------------------------------------------------

  private async uploadFiles(input: HTMLInputElement, kind: 'cover' | 'spread'): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    for (const file of files) {
      const row = el(
        'li',
        { class: 'image-row' },
        el('span', { class: 'image-name' }, file.name),
        el('span', { class: 'image-state' }, 'Uploading'),
      );
      this.imageList.appendChild(row);
      announceText(this.result, STUDIO_RESULT.uploading(file.name));
      try {
        await post<MediaDto>(`/api/campaigns/${this.campaign.id}/media?kind=${kind}`, {
          raw: file,
          contentType: file.type,
        });
        announceText(
          this.result,
          kind === 'cover' ? STUDIO_RESULT.coverStored : STUDIO_RESULT.imageStored,
        );
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
          announceText(this.result, STUDIO_RESULT.storageDown);
        } else if (error instanceof ApiFailure && error.status === 422) {
          this.errorHost('media').replaceChildren(
            ...Object.values(error.fields).map((message) => fieldError(message)),
          );
          announceText(this.result, STUDIO_RESULT.validation);
        } else {
          announceText(this.result, outageCopy(error));
        }
      }
      await this.reload();
    }
  }

  private renderImages(media: readonly MediaDto[]): void {
    if (media.length === 0) {
      this.imageList.replaceChildren(el('li', { class: 'image-row' }, 'No images yet.'));
      return;
    }
    this.imageList.replaceChildren(
      ...media.map((item) => {
        const remove = el(
          'button',
          { type: 'button', class: 'button button--quiet' },
          'Remove image',
        );
        remove.disabled = this.campaign.status !== 'draft';
        remove.addEventListener('click', () => {
          void (async () => {
            try {
              await del(`/api/media/${item.id}`);
            } catch (error) {
              announceText(this.result, outageCopy(error));
              return;
            }
            await this.reload();
          })();
        });
        return el(
          'li',
          { class: 'image-row' },
          el('span', { class: 'image-name' }, item.kind === 'cover' ? 'Cover art' : 'Spread'),
          el('span', { class: 'image-state' }, imageStateWord(item.status)),
          remove,
        );
      }),
    );
  }

  private renderPreviewCover(): void {
    const cover = this.campaign.media.find(
      (item) => item.kind === 'cover' && item.status === 'stored',
    );
    this.previewCover.replaceChildren(
      coverCircle(cover?.id ?? null, this.campaign.title, 'cover--lead'),
    );
  }

  private refreshPreview(): void {
    this.previewGauge?.setReading({
      total: 0,
      goal: this.campaign.goal,
      stretch: this.campaign.stretch,
    });
    this.renderPreviewCover();
  }

  private async reload(): Promise<void> {
    this.campaign = await get<CampaignDto>(`/api/campaigns/${this.campaign.id}`);
    this.renderImages(this.campaign.media);
    this.refreshPreview();
    this.renderStudioPanels();
  }

  // --- Launch ----------------------------------------------------------------

  private async launch(): Promise<void> {
    this.clearFieldErrors();
    try {
      await post<CampaignDto>(`/api/campaigns/${this.campaign.id}/launch`);
      announceText(this.result, STUDIO_RESULT.launched);
      navigate(`/campaigns/${this.campaign.id}`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'media_not_stored') {
        announceText(this.result, STUDIO_RESULT.launchNeedsImages);
        return;
      }
      if (error instanceof ApiFailure && error.status === 422) {
        this.showFieldErrors(error.fields);
        return;
      }
      announceText(this.result, outageCopy(error));
    }
  }

  // --- Backers and settlement -----------------------------------------------

  private readonly panels = el('div', { class: 'editor-panels' });

  private studioPanels(): HTMLElement {
    this.renderStudioPanels();
    return this.panels;
  }

  private renderStudioPanels(): void {
    if (this.campaign.status === 'draft') {
      this.panels.replaceChildren();
      return;
    }
    const backers = el('div', { class: 'panel' }, loadingStatus());
    const settlement = el('div', {
      role: 'region',
      'aria-label': 'Settlement',
      class: 'panel',
    });
    this.panels.replaceChildren(backers, settlement);
    void this.loadBackers(backers);
    void this.loadSettlement(settlement);
  }

  private async loadBackers(host: HTMLElement): Promise<void> {
    let pledges: PledgeWithBackerDto[];
    try {
      pledges = await get<PledgeWithBackerDto[]>(`/api/campaigns/${this.campaign.id}/pledges`);
    } catch {
      host.replaceChildren(emptyState(EMPTY_STATES.backers));
      return;
    }
    const counted = pledges.filter(
      (pledge) =>
        pledge.state === 'authorised' ||
        pledge.state === 'captured' ||
        pledge.state === 'errored',
    );
    if (counted.length === 0) {
      host.replaceChildren(
        el('h2', { class: 'section-heading' }, 'Backers'),
        emptyState(EMPTY_STATES.backers),
      );
      return;
    }
    const table = el(
      'table',
      { class: 'table', 'aria-label': 'Backers' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, 'Backer'),
          el('th', { scope: 'col' }, 'Email'),
          el('th', { scope: 'col' }, 'Tier'),
          el('th', { scope: 'col' }, 'Amount'),
          el('th', { scope: 'col' }, 'State'),
        ),
      ),
      el(
        'tbody',
        {},
        ...counted.map((pledge) => {
          const tier = this.campaign.tiers.find((item) => item.id === pledge.tier_id);
          return el(
            'tr',
            {},
            el('td', { 'data-label': 'Backer' }, pledge.backer.name),
            el('td', { 'data-label': 'Email' }, pledge.backer.email),
            el('td', { 'data-label': 'Tier' }, tier?.title ?? ''),
            el('td', { 'data-label': 'Amount', class: 'figures' }, formatMoney(pledge.amount)),
            el('td', { 'data-label': 'State' }, stateMark(pledge.state)),
          );
        }),
      ),
    );
    host.replaceChildren(el('h2', { class: 'section-heading' }, 'Backers'), table);
  }

  private async loadSettlement(host: HTMLElement): Promise<void> {
    let settlement: SettlementDto;
    try {
      settlement = await get<SettlementDto>(`/api/campaigns/${this.campaign.id}/settlement`);
    } catch {
      host.replaceChildren(
        el('h2', { class: 'section-heading' }, 'Settlement'),
        el('p', {}, 'A settlement appears once the run is funded.'),
      );
      return;
    }
    const download = el(
      'a',
      { href: `/api/campaigns/${this.campaign.id}/settlement.pdf`, class: 'button' },
      'Download settlement sheet',
    );
    download.addEventListener('click', (event) => {
      event.preventDefault();
      void downloadFile(
        `/api/campaigns/${this.campaign.id}/settlement.pdf`,
        `dotgain-settlement-${this.campaign.id}.pdf`,
      );
    });
    host.replaceChildren(
      el('h2', { class: 'section-heading' }, 'Settlement'),
      el(
        'dl',
        { class: 'pledge-summary' },
        el('dt', {}, 'Captured pledges'),
        el('dd', { class: 'figures' }, String(settlement.captured_count)),
        el('dt', {}, 'Dropped pledges'),
        el('dd', { class: 'figures' }, String(settlement.dropped_count)),
        el('dt', {}, 'Gross'),
        el('dd', { class: 'figures' }, formatMoney(settlement.gross)),
        el('dt', {}, 'Platform fees'),
        el('dd', { class: 'figures' }, formatMoney(settlement.platform_fee)),
        el('dt', {}, 'Processing fees'),
        el('dd', { class: 'figures' }, formatMoney(settlement.processing_fee)),
        el('dt', {}, 'Net to creator'),
        el('dd', { class: 'figures' }, formatMoney(settlement.net)),
      ),
      settlement.pdf === 'ready'
        ? download
        : el('p', {}, 'The settlement sheet is being prepared.'),
    );
  }
}

const FIELD_IDS: Readonly<Record<string, string>> = {
  title: 'editor-title',
  story: 'editor-story',
  goal: 'editor-goal',
  min_run_copies: 'editor-min-run',
  ships_from: 'editor-ships-from',
  time_zone: 'editor-time-zone',
  deadline_local: 'editor-deadline',
  cover: 'editor-cover',
  media: 'editor-spreads',
  tiers: 'editor-spreads',
};

function imageStateWord(status: MediaDto['status']): string {
  if (status === 'stored') return 'Stored';
  if (status === 'uploading') return 'Uploading';
  return 'Not stored';
}

function outageCopy(error: unknown): string {
  if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
    return STUDIO_RESULT.storageDown;
  }
  return STUDIO_RESULT.validation;
}

export function renderEditor(main: HTMLElement, id: string): void {
  const host = el('div', { class: 'page-host' }, loadingStatus());
  main.replaceChildren(host);
  if (heldKey() === null) {
    renderNotFound(main);
    return;
  }
  void (async () => {
    try {
      const campaign = await get<CampaignDto>(`/api/campaigns/${id}`);
      new Editor(host, campaign).render();
    } catch {
      renderNotFound(main);
    }
  })();
}
