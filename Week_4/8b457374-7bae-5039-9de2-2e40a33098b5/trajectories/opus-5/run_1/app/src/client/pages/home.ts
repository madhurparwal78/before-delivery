import { EMPTY_STATES, HERO } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import type { CampaignRowDto } from '../../shared/types.js';
import { get } from '../api.js';
import { el } from '../dom.js';
import { drawHeroDisc } from '../ui/hero.js';
import { coverCircle, emptyState, loadingStatus } from '../ui/parts.js';
import { PlateFill } from '../ui/plateFill.js';
import { openDetailsDialog } from './details.js';

function campaignRow(campaign: CampaignRowDto): HTMLElement {
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
      el('a', { href: `/campaigns/${campaign.id}`, class: 'campaign-row-title' }, campaign.title),
      el('p', { class: 'campaign-row-total figures' }, formatMoney(campaign.total)),
    ),
    gauge.root,
  );
}

export function renderHome(main: HTMLElement): void {
  const hero = el(
    'section',
    { class: 'hero' },
    el(
      'div',
      { class: 'hero-copy' },
      el(
        'h1',
        { class: 'hero-headline' },
        el('span', { class: 'hero-line' }, HERO.headlineTop),
        ' ',
        el('span', { class: 'hero-line' }, HERO.headlineBottom),
      ),
      el('p', { class: 'hero-sentence' }, HERO.sentence),
      el(
        'button',
        { type: 'button', class: 'button button--stadium hero-cta' },
        HERO.cta,
      ),
    ),
  );

  const list = el('ul', { class: 'campaign-list', 'aria-label': 'Live campaigns' });
  const listHost = el('section', { class: 'home-list' }, loadingStatus());
  main.replaceChildren(hero, listHost);

  const start = hero.querySelector('.hero-cta') as HTMLButtonElement;
  start.addEventListener('click', () => openDetailsDialog(start));

  drawHeroDisc(hero);
  const redraw = (): void => drawHeroDisc(hero);
  window.addEventListener('resize', redraw, { passive: true });

  void (async () => {
    const campaigns = await get<CampaignRowDto[]>('/api/campaigns');
    const live = campaigns.filter((campaign) => campaign.status === 'live');
    if (live.length === 0) {
      listHost.replaceChildren(emptyState(EMPTY_STATES.home));
      return;
    }
    list.replaceChildren(...live.map(campaignRow));
    listHost.replaceChildren(list);
  })();
}
