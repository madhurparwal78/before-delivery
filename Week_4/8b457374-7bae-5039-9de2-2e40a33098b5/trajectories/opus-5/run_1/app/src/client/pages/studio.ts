import { EMPTY_STATES } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import type { CampaignRowDto } from '../../shared/types.js';
import { get } from '../api.js';
import { el } from '../dom.js';
import { heldKey } from '../session.js';
import { coverCircle, emptyState, loadingStatus } from '../ui/parts.js';
import { PlateFill } from '../ui/plateFill.js';
import { openDetailsDialog } from './details.js';

const STATUS_WORDS: Readonly<Record<CampaignRowDto['status'], string>> = {
  draft: 'Draft',
  live: 'Live',
  funded: 'Funded',
  collecting: 'Collecting',
  settled: 'Settled',
  unfunded: 'Not funded',
  cancelled: 'Cancelled',
};

function studioRow(campaign: CampaignRowDto): HTMLElement {
  const gauge = new PlateFill(
    { total: campaign.total, goal: campaign.goal, stretch: [] },
    `Plate Fill: ${campaign.percent}%`,
  );
  gauge.root.classList.add('plate--mini');
  return el(
    'li',
    { class: 'campaign-row' },
    coverCircle(campaign.cover_media_id, campaign.title, 'cover--list'),
    el(
      'div',
      { class: 'campaign-row-body' },
      el(
        'a',
        { href: `/studio/campaigns/${campaign.id}`, class: 'campaign-row-title' },
        campaign.title,
      ),
      el('p', { class: 'chip' }, STATUS_WORDS[campaign.status]),
      el('p', { class: 'campaign-row-total figures' }, formatMoney(campaign.total)),
    ),
    gauge.root,
  );
}

export function renderStudio(main: HTMLElement): void {
  const newCampaign = el('button', { type: 'button', class: 'button' }, 'New campaign');
  const listHost = el('div', { class: 'studio-list' });
  main.replaceChildren(
    el(
      'section',
      { class: 'page page--narrow' },
      el(
        'div',
        { class: 'page-head' },
        el('h1', { class: 'page-heading' }, 'Studio'),
        newCampaign,
      ),
      listHost,
    ),
  );
  newCampaign.addEventListener('click', () => openDetailsDialog(newCampaign));

  if (heldKey() === null) {
    listHost.replaceChildren(emptyState(EMPTY_STATES.studio));
    return;
  }

  listHost.replaceChildren(loadingStatus());
  void (async () => {
    try {
      const campaigns = await get<CampaignRowDto[]>('/api/me/campaigns');
      if (campaigns.length === 0) {
        listHost.replaceChildren(emptyState(EMPTY_STATES.studio));
        return;
      }
      listHost.replaceChildren(
        el(
          'ul',
          { class: 'campaign-list', 'aria-label': 'Your campaigns' },
          ...campaigns.map(studioRow),
        ),
      );
    } catch {
      listHost.replaceChildren(emptyState(EMPTY_STATES.studio));
    }
  })();
}
