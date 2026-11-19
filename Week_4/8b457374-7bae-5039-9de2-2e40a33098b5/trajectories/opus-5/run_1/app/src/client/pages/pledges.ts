import { EMPTY_STATES } from '../../shared/copy.js';
import { formatMoney } from '../../shared/money.js';
import type { CampaignDto, PledgeWithCampaignDto } from '../../shared/types.js';
import { downloadFile, get } from '../api.js';
import { el } from '../dom.js';
import { navigate } from '../router.js';
import { heldKey } from '../session.js';
import { coverCircle, emptyState, loadingStatus, stateMark } from '../ui/parts.js';

const REFRESH_MS = 30_000;

function statementAction(pledge: PledgeWithCampaignDto): HTMLElement | null {
  if (pledge.statement === 'ready') {
    const path = `/api/pledges/${pledge.id}/statement.pdf`;
    const download = el(
      'a',
      { href: path, class: 'button button--quiet', download: `dotgain-statement-${pledge.id}.pdf` },
      'Download statement',
    );
    download.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void downloadFile(path, `dotgain-statement-${pledge.id}.pdf`);
    });
    return download;
  }
  if (pledge.statement === 'pending') {
    return el('p', { class: 'pledge-row-note' }, 'Statement being prepared');
  }
  return null;
}

function manageAction(pledge: PledgeWithCampaignDto): HTMLElement {
  const href = `/campaigns/${pledge.campaign.id}`;
  const link = el('a', { href, class: 'button button--quiet' }, 'Manage pledge');
  link.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    navigate(href, { focusChange: true });
  });
  return link;
}

function pledgeRow(pledge: PledgeWithCampaignDto, tierTitle: string): HTMLElement {
  const actions = el('div', { class: 'pledge-row-actions' }, statementAction(pledge));
  if (pledge.state === 'errored' && pledge.fix_code !== null) {
    actions.appendChild(
      el('a', { href: `/fix/${pledge.fix_code}`, class: 'button button--quiet' }, 'Fix payment'),
    );
  }
  if (pledge.state === 'authorised') actions.appendChild(manageAction(pledge));

  return el(
    'li',
    { class: 'pledge-row' },
    coverCircle(pledge.campaign.cover_media_id, pledge.campaign.title, 'cover--list'),
    el(
      'div',
      { class: 'pledge-row-body' },
      el(
        'a',
        { href: `/campaigns/${pledge.campaign.id}`, class: 'pledge-row-title' },
        pledge.campaign.title,
      ),
      el('p', { class: 'pledge-row-tier' }, tierTitle),
      el('p', { class: 'pledge-row-amount figures' }, formatMoney(pledge.amount)),
      el('p', { class: 'pledge-row-state' }, stateMark(pledge.state)),
    ),
    actions,
  );
}

/** Tier titles live on the campaign, so each backed campaign is read once. */
async function tierTitles(pledges: readonly PledgeWithCampaignDto[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const campaignIds = [...new Set(pledges.map((pledge) => pledge.campaign.id))];
  await Promise.all(
    campaignIds.map(async (id) => {
      try {
        const campaign = await get<CampaignDto>(`/api/campaigns/${id}`);
        for (const tier of campaign.tiers) titles.set(tier.id, tier.title);
      } catch {
        // A campaign that cannot be read leaves its tier unnamed in the row.
      }
    }),
  );
  return titles;
}

export function renderPledges(main: HTMLElement): () => void {
  const listHost = el('div', { class: 'pledges-list' }, loadingStatus());
  main.replaceChildren(
    el(
      'section',
      { class: 'page page--narrow' },
      el('h1', { class: 'page-heading' }, 'My pledges'),
      listHost,
    ),
  );

  if (heldKey() === null) {
    listHost.replaceChildren(emptyState(EMPTY_STATES.pledges));
    return () => undefined;
  }

  let disposed = false;
  const load = async (): Promise<void> => {
    let pledges: PledgeWithCampaignDto[];
    try {
      pledges = await get<PledgeWithCampaignDto[]>('/api/me/pledges');
    } catch {
      listHost.replaceChildren(emptyState(EMPTY_STATES.pledges));
      return;
    }
    if (disposed) return;
    if (pledges.length === 0) {
      listHost.replaceChildren(emptyState(EMPTY_STATES.pledges));
      return;
    }
    const titles = await tierTitles(pledges);
    if (disposed) return;
    listHost.replaceChildren(
      el(
        'ul',
        { class: 'pledge-list', 'aria-label': 'Pledges' },
        ...pledges.map((pledge) => pledgeRow(pledge, titles.get(pledge.tier_id) ?? '')),
      ),
    );
  };

  void load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  return () => {
    disposed = true;
    window.clearInterval(timer);
  };
}
