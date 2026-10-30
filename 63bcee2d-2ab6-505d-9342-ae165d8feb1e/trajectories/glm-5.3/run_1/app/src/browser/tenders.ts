// Tenders: list, setup, contractor bid form and levelling.

import { api, ApiError, fieldErrorCopy, refusalCopy } from './api.js';
import {
  amountText,
  announce,
  clear,
  h,
  instantText,
  openDialog,
  reportProblem,
  setFocusTarget,
  showFieldErrors,
} from './ui.js';
import { currentMember, panelTitleBlock, STUDIO_ROLES } from './office.js';

interface ProjectData {
  id: string;
  reference: string;
  name: string;
  region: 'HK' | 'SG' | 'MO';
  currency: 'HKD' | 'SGD';
}

export function displayStatus(tender: Record<string, unknown>, closesAt: string | null): string {
  const status = String(tender.status ?? 'draft');
  if (status === 'open' && closesAt && Date.now() >= Date.parse(closesAt)) return 'Closed';
  const words: Record<string, string> = { draft: 'Draft', open: 'Open', closed: 'Closed', opened: 'Opened', awarded: 'Awarded' };
  return words[status] ?? status;
}

export async function tendersListPanel(panel: HTMLElement, project: ProjectData, canCreate: boolean): Promise<void> {
  const list = h('ul', { class: 'tender-list' });
  const newButton = h('button', { class: 'button-primary', text: 'New tender', onclick: () => newTenderDialog() });
  if (!canCreate) newButton.style.display = 'none';

  async function render(): Promise<void> {
    clear(list);
    const body = await api(`/api/projects/${project.id}/tenders`);
    const tenders = (body.tenders ?? []) as Record<string, unknown>[];
    for (const tender of tenders) {
      const status = displayStatus(tender, tender.closesAt as string | null);
      list.append(
        h('li', { class: 'tender-item' }, h('a', { href: `/office/tenders/${tender.id}`, text: String(tender.title) }), h('span', { class: 'small-caps', text: status })),
      );
    }
  }

  function newTenderDialog(): void {
    const title = h('input', { type: 'text', id: 'field-title', class: 'input' }) as HTMLInputElement;
    const scope = h('textarea', { id: 'field-scope', class: 'input', rows: '4' }) as HTMLTextAreaElement;
    const closesAt = h('input', { type: 'datetime-local', id: 'field-closesAtLocal', class: 'input', step: '1' }) as HTMLInputElement;
    const contingency = h('input', { type: 'text', id: 'field-contingencyPercent', class: 'input', value: '5.00' }) as HTMLInputElement;
    const bidders: { companyName: HTMLInputElement; contactName: HTMLInputElement; contactEmail: HTMLInputElement }[] = [];
    const biddersContainer = h('div', {});
    function addBidderGroup(index: number): void {
      const group = h('div', { class: 'bidder-group', role: 'group', 'aria-label': `Bidder ${index}` });
      const companyName = h('input', { type: 'text', id: `field-bidders-${index}-companyName`, class: 'input' }) as HTMLInputElement;
      const contactName = h('input', { type: 'text', id: `field-bidders-${index}-contactName`, class: 'input' }) as HTMLInputElement;
      const contactEmail = h('input', { type: 'email', id: `field-bidders-${index}-contactEmail`, class: 'input' }) as HTMLInputElement;
      const remove = h('button', {
        type: 'button',
        class: 'button-quiet',
        text: `Remove bidder ${index}`,
        onclick: () => {
          bidders.splice(index - 1, 1);
          group.remove();
        },
      });
      group.append(
        h('div', { class: 'field' }, h('label', { for: companyName.id, text: 'Company name' }), companyName),
        h('div', { class: 'field' }, h('label', { for: contactName.id, text: 'Contact name' }), contactName),
        h('div', { class: 'field' }, h('label', { for: contactEmail.id, text: 'Contact email' }), contactEmail),
        remove,
      );
      biddersContainer.append(group);
      bidders.push({ companyName, contactName, contactEmail });
    }
    addBidderGroup(1);
    const addBidder = h('button', { type: 'button', class: 'button-quiet', text: 'Add bidder', onclick: () => addBidderGroup(bidders.length + 1) });
    const saveDraft = h('button', { class: 'button-secondary', type: 'submit', text: 'Save draft' });
    const publish = h('button', { class: 'button-primary', text: 'Publish tender' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        saveDraft.disabled = true;
        saveDraft.textContent = 'Saving…';
        try {
          const result = await api(`/api/projects/${project.id}/tenders`, {
            method: 'POST',
            body: JSON.stringify({
              title: title.value,
              scope: scope.value,
              closesAtLocal: closesAt.value ? `${closesAt.value}:00` : undefined,
              contingencyPercent: contingency.value,
              bidders: bidders.map((bidder) => ({
                companyName: bidder.companyName.value,
                contactName: bidder.contactName.value,
                contactEmail: bidder.contactEmail.value,
              })),
            }),
          });
          const tender = result.tender as Record<string, unknown>;
          announce('Tender draft saved.');
          saveDraft.disabled = false;
          saveDraft.textContent = 'Save draft';
          const publishHandler = async () => {
            publish.disabled = true;
            publish.textContent = 'Publishing…';
            try {
              await api(`/api/tenders/${tender.id}/publish`, { method: 'POST', body: '{}' });
              const publishDialog = openDialog('Publish tender', (container, close) => {
                const confirmPublish = h('button', {
                  class: 'button-primary',
                  text: 'Publish and send invitations',
                  onclick: async () => {
                    try {
                      const fresh = await api(`/api/tenders/${tender.id}`);
                      const freshTender = fresh.tender as Record<string, unknown>;
                      announce(`Tender published. Invitations sent to ${(freshTender.bidders as unknown[]).length} bidders.`);
                      close();
                      dialogHandle.close();
                      window.location.assign(`/office/tenders/${tender.id}`);
                    } catch (error) {
                      confirmPublish.disabled = false;
                      if (error instanceof ApiError) reportProblem(refusalCopy(error));
                    }
                  },
                });
                container.append(confirmPublish);
              });
              void publishDialog;
            } catch (error) {
              publish.disabled = false;
              publish.textContent = 'Publish tender';
              if (error instanceof ApiError) reportProblem(refusalCopy(error));
            }
          };
          publish.removeEventListener('click', publishHandler);
          publish.addEventListener('click', publishHandler);
          setFocusTarget(publish);
        } catch (error) {
          saveDraft.disabled = false;
          saveDraft.textContent = 'Save draft';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('New tender', (container) => {
      form.append(
        h('div', { class: 'field' }, h('label', { for: 'field-title', text: 'Tender title' }), title),
        h('div', { class: 'field' }, h('label', { for: 'field-scope', text: 'Scope' }), scope),
        h('div', { class: 'field' }, h('label', { for: 'field-closesAtLocal', text: 'Close date and time' }), closesAt, h('p', { class: 'field-hint', text: project.region === 'SG' ? 'Singapore time' : 'Hong Kong time' })),
        h('div', { class: 'field' }, h('label', { for: 'field-contingencyPercent', text: 'Contingency percent' }), contingency),
        biddersContainer,
        addBidder,
        h('div', { class: 'form-actions' }, saveDraft, publish),
      );
      container.append(form);
    });
  }

  panel.append(newButton, list);
  await render();
}

export async function tenderDetailScreen(tenderId: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main' });
  let tender: Record<string, unknown>;
  try {
    const body = await api(`/api/tenders/${tenderId}`);
    tender = body.tender as Record<string, unknown>;
  } catch {
    main.append(h('h1', { text: "We couldn't find that. It may have been removed, or you may not have access." }));
    return main;
  }
  const project = tender.project as { id: string; reference: string; name: string };
  const status = displayStatus(tender, tender.closesAt as string | null);
  const panelElement = h('div', { class: 'panel' }, panelTitleBlock('PL-03', String(tender.title)));
  const statusHeading = h('h2', { text: 'Tender status', tabindex: '-1', 'data-status-heading': 'true' });
  const statusText = h('p', { class: 'small-caps', text: status });
  const info = h('p', { text: `${project.reference} ${project.name}` });
  panelElement.append(statusHeading, statusText, info);
  main.append(panelElement);

  const isStudio = STUDIO_ROLES.includes(currentMember!.role);
  const isStudioLead = currentMember!.role === 'director' || currentMember!.role === 'project_lead';
  const isContractor = currentMember!.role === 'contractor';

  if (isStudio) {
    const bidders = (tender.bidders ?? []) as Record<string, unknown>[];
    const bidderList = h('ul', { class: 'bidder-list' });
    for (const bidder of bidders) {
      bidderList.append(
        h('li', { text: `${String(bidder.reference)} ${String(bidder.companyName)} — ${String(bidder.contactName)} (${String(bidder.contactEmail)}) — ${bidder.hasBid ? 'has bid' : 'no bid'}` }),
      );
    }
    panelElement.append(h('h3', { text: 'Bidders' }), bidderList);
    const actions = h('div', { class: 'panel-actions' });
    if (String(tender.status) === 'draft' && isStudioLead) {
      const publish = h('button', {
        class: 'button-primary',
        text: 'Publish tender',
        onclick: () => {
          openDialog('Publish tender', (container, close) => {
            const confirmPublish = h('button', {
              class: 'button-primary',
              text: 'Publish and send invitations',
              onclick: async () => {
                try {
                  const fresh = await api(`/api/tenders/${tenderId}/publish`, { method: 'POST', body: '{}' });
                  const freshTender = fresh.tender as Record<string, unknown>;
                  announce(`Tender published. Invitations sent to ${(freshTender.bidders as unknown[]).length} bidders.`);
                  close();
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch (error) {
                  if (error instanceof ApiError) reportProblem(refusalCopy(error));
                }
              },
            });
            container.append(confirmPublish);
          });
        },
      });
      actions.append(publish);
    }
    if (String(tender.status) === 'open' && isStudioLead) {
      const closeInstant = tender.closesAt as string | null;
      const closedByClock = closeInstant !== null && Date.now() >= Date.parse(closeInstant);
      if (!closedByClock) {
        const moveClose = h('button', {
          class: 'button-secondary',
          text: 'Move close',
          onclick: () => {
            const input = h('input', { type: 'datetime-local', id: 'field-closesAtLocal', class: 'input', step: '1' }) as HTMLInputElement;
            const save = h('button', { class: 'button-primary', text: 'Save new close' });
            const form = h('form', {
              onsubmit: async (event: Event) => {
                event.preventDefault();
                save.disabled = true;
                save.textContent = 'Saving…';
                try {
                  const fresh = await api(`/api/tenders/${tenderId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ closesAtLocal: `${input.value}:00` }),
                  });
                  const freshTender = fresh.tender as Record<string, unknown>;
                  announce(`Close moved to ${instantText(String(freshTender.closesAt), (tender.project as { region?: 'HK' | 'SG' | 'MO' }).region ?? 'HK')}. Updated invitations sent to ${(freshTender.bidders as unknown[]).length} bidders.`);
                  dialogHandle.close();
                  setFocusTarget(moveClose);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                } catch (error) {
                  save.disabled = false;
                  save.textContent = 'Save new close';
                  if (error instanceof ApiError) {
                    if (error.status === 422) {
                      showFieldErrors(form, fieldErrorCopy(error));
                      return;
                    }
                    reportProblem(refusalCopy(error));
                  }
                }
              },
            });
            const dialogHandle = openDialog('Move close', (container) => {
              form.append(h('div', { class: 'field' }, h('label', { for: 'field-closesAtLocal', text: 'Close date and time' }), input), h('div', { class: 'form-actions' }, save));
              container.append(form);
            });
          },
        });
        actions.append(moveClose);
      }
      const openBids = h('button', {
        class: 'button-primary',
        text: 'Open bids',
        onclick: async () => {
          openBids.disabled = true;
          openBids.textContent = 'Opening bids…';
          try {
            const fresh = await api(`/api/tenders/${tenderId}/open-bids`, { method: 'POST', body: '{}' });
            const freshTender = fresh.tender as Record<string, unknown>;
            announce(`Bids opened. ${(freshTender.bidders as Record<string, unknown>[]).filter((b) => b.hasBid).length} bids are ready to level.`);
            window.location.assign(`/office/tenders/${tenderId}/levelling`);
          } catch (error) {
            openBids.disabled = false;
            openBids.textContent = 'Open bids';
            if (error instanceof ApiError) reportProblem(refusalCopy(error));
          }
        },
      });
      actions.append(openBids);
    }
    if (String(tender.status) === 'opened' || String(tender.status) === 'awarded') {
      actions.append(h('a', { class: 'button-secondary', href: `/office/tenders/${tenderId}/levelling`, text: 'Open levelling' }));
    }
    panelElement.append(actions);
  }

  if (isContractor) {
    const bidForm = h('form', { class: 'bid-form', 'aria-label': 'Contractor bid form' });
    const myBid = tender.myBid as Record<string, unknown> | null;
    const base = h('input', { type: 'text', id: 'field-baseCents', class: 'input', inputmode: 'decimal', value: myBid ? (Number(myBid.baseCents) / 100).toFixed(2) : '' }) as HTMLInputElement;
    const provisionalContainer = h('div', {});
    const provisionalGroups: { label: HTMLInputElement; amount: HTMLInputElement }[] = [];
    const addProvisional = (labelText?: string, amountValue?: string) => {
      const index = provisionalGroups.length + 1;
      const label = h('input', { type: 'text', class: 'input', id: `field-provisional-${index}-label`, value: labelText ?? '', 'aria-label': 'Provisional sum label' }) as HTMLInputElement;
      const amount = h('input', { type: 'text', class: 'input', id: `field-provisional-${index}-amount`, inputmode: 'decimal', value: amountValue ?? '', 'aria-label': 'Provisional sum amount' }) as HTMLInputElement;
      provisionalContainer.append(
        h('div', { class: 'provisional-group' },
          h('div', { class: 'field' }, h('label', { for: label.id, text: 'Provisional sum label' }), label),
          h('div', { class: 'field' }, h('label', { for: amount.id, text: 'Provisional sum amount' }), amount)),
      );
      provisionalGroups.push({ label, amount });
    };
    for (const sum of ((myBid?.provisionalSums ?? []) as { label: string; amountCents: number }[])) {
      addProvisional(sum.label, (sum.amountCents / 100).toFixed(2));
    }
    const addProvisionalButton = h('button', { type: 'button', class: 'button-quiet', text: 'Add provisional sum', onclick: () => addProvisional() });
    const exclusionsContainer = h('div', {});
    const exclusionGroups: { label: HTMLInputElement }[] = [];
    const addExclusion = (labelText?: string) => {
      const index = exclusionGroups.length + 1;
      const label = h('input', { type: 'text', class: 'input', id: `field-exclusion-${index}`, value: labelText ?? '', 'aria-label': 'Exclusion' }) as HTMLInputElement;
      exclusionsContainer.append(h('div', { class: 'field' }, h('label', { for: label.id, text: 'Exclusion' }), label));
      exclusionGroups.push({ label });
    };
    for (const exclusion of ((myBid?.exclusions ?? []) as { label: string }[])) {
      addExclusion(exclusion.label);
    }
    const addExclusionButton = h('button', { type: 'button', class: 'button-quiet', text: 'Add exclusion', onclick: () => addExclusion() });
    const submit = h('button', {
      class: 'button-primary',
      type: 'submit',
      text: myBid ? 'Submit amendment' : 'Submit bid',
    });
    bidForm.append(
      h('div', { class: 'field' }, h('label', { for: 'field-baseCents', text: 'Base amount' }), base),
      provisionalContainer,
      addProvisionalButton,
      exclusionsContainer,
      addExclusionButton,
      h('div', { class: 'form-actions' }, submit),
    );
    bidForm.addEventListener('submit', async (event: Event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = myBid ? 'Submitting amendment…' : 'Submitting bid…';
      const payload = {
        baseCents: Math.round(parseFloat(base.value || '0') * 100),
        provisionalSums: provisionalGroups
          .filter((group) => group.label.value.trim())
          .map((group) => ({ label: group.label.value, amountCents: Math.round(parseFloat(group.amount.value || '0') * 100) })),
        exclusions: exclusionGroups.filter((group) => group.label.value.trim()).map((group) => ({ label: group.label.value })),
      };
      try {
        const result = myBid
          ? await api(`/api/tenders/${tenderId}/bid`, { method: 'PUT', body: JSON.stringify(payload) })
          : await api(`/api/tenders/${tenderId}/bid`, { method: 'POST', body: JSON.stringify(payload) });
        const bid = result.bid as Record<string, unknown>;
        const at = instantText(String(bid.finalSubmittedAt), (tender.project as { region?: 'HK' | 'SG' | 'MO' }).region ?? 'HK');
        announce(myBid ? `Bid amended at ${at}. Your latest amendment is the one that counts.` : `Bid submitted at ${at}.`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (error) {
        submit.disabled = false;
        submit.textContent = myBid ? 'Submit amendment' : 'Submit bid';
        if (error instanceof ApiError) {
          if (error.status === 422) {
            showFieldErrors(bidForm, fieldErrorCopy(error));
            return;
          }
          reportProblem(refusalCopy(error));
        }
      }
    });
    panelElement.append(h('h3', { text: 'Your bid' }), bidForm);
  }
  return main;
}

export async function levellingScreen(tenderId: string): Promise<HTMLElement> {
  const main = h('main', { id: 'main-content', class: 'office-main levelling' });
  let data: Record<string, unknown>;
  try {
    data = await api(`/api/tenders/${tenderId}/levelling`);
  } catch (error) {
    main.append(h('h1', { text: "We couldn't find that. It may have been removed, or you may not have access." }));
    return main;
  }
  const currency = String(data.currency ?? 'HKD');
  const bids = (data.bids ?? []) as Record<string, unknown>[];
  main.append(panelTitleBlock('PL-03', 'Levelling'));
  // URL state: sort, dir, unpriced, q.
  const params = new URLSearchParams(window.location.search);
  let sortKey = params.get('sort') ?? 'rank';
  let sortDir = params.get('dir') ?? 'asc';
  let unpricedFilter = params.get('unpriced') ?? '';
  let search = params.get('q') ?? '';
  const table = h('table', { class: 'data-table levelling-table', 'aria-label': 'Levelling' }) as HTMLTableElement;
  const headRow = table.tHead!.insertRow();
  const columns: { key: string; label: string; sortable: boolean }[] = [
    { key: 'rank', label: 'Rank', sortable: true },
    { key: 'bidder', label: 'Bidder', sortable: true },
    { key: 'base', label: 'Base', sortable: true },
    { key: 'provisional', label: 'Provisional sums', sortable: true },
    { key: 'allowances', label: 'Allowances', sortable: true },
    { key: 'exclusions', label: 'Priced exclusions', sortable: true },
    { key: 'contingency', label: 'Contingency', sortable: false },
    { key: 'levelled', label: 'Levelled total', sortable: true },
    { key: 'submitted', label: 'Submitted', sortable: true },
    { key: 'actions', label: 'Actions', sortable: false },
  ];
  for (const column of columns) {
    const th = h('th', { scope: 'col' });
    if (column.sortable) {
      const button = h('button', { text: column.label, onclick: () => setSort(column.key) });
      th.append(button);
      if (sortKey === column.key) {
        th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      }
    } else {
      th.textContent = column.label;
    }
    headRow.append(th);
  }
  const tbody = h('tbody');
  table.append(tbody);
  const findBidder = h('input', { type: 'search', id: 'find-bidder', class: 'input', value: search }) as HTMLInputElement;
  findBidder.setAttribute('aria-label', 'Find bidder');
  const unpricedSelect = h('select', { id: 'unpriced', class: 'input' }) as HTMLSelectElement;
  unpricedSelect.setAttribute('aria-label', 'Unpriced exclusions');
  for (const [value, label] of [['', 'Show all'], ['only', 'Only unpriced'], ['hide', 'Hide unpriced']] as [string, string][]) {
    const option = h('option', { value, text: label });
    if (value === unpricedFilter) option.setAttribute('selected', 'true');
    unpricedSelect.append(option);
  }
  const exportLink = h('a', { class: 'button-quiet', href: `/api/tenders/${tenderId}/levelling.csv`, text: 'Export levelling CSV' });
  const awardButton = h('button', { class: 'button-primary', text: 'Award' });

  function setSort(key: string): void {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    updateUrl();
  }

  function updateUrl(): void {
    const next = new URLSearchParams();
    if (sortKey && sortKey !== 'rank') next.set('sort', sortKey);
    if (sortDir && sortDir !== 'asc') next.set('dir', sortDir);
    if (unpricedFilter) next.set('unpriced', unpricedFilter);
    if (search) next.set('q', search);
    const query = next.toString();
    window.history.pushState({}, '', `/office/tenders/${tenderId}/levelling${query ? `?${query}` : ''}`);
    renderRows();
  }

  findBidder.addEventListener('input', () => {
    search = findBidder.value;
    updateUrl();
  });
  unpricedSelect.addEventListener('change', () => {
    unpricedFilter = unpricedSelect.value;
    updateUrl();
  });

  function renderRows(): Promise<void> {
    clear(tbody);
    let rows = [...bids];
    if (unpricedFilter === 'only') rows = rows.filter((bid) => Number(bid.unpricedExclusions) > 0);
    if (unpricedFilter === 'hide') rows = rows.filter((bid) => Number(bid.unpricedExclusions) === 0);
    if (search) {
      const term = search.toLowerCase();
      rows = rows.filter((bid) => `${String(bid.reference)} ${String(bid.companyName)}`.toLowerCase().includes(term));
    }
    const sortValue = (bid: Record<string, unknown>, key: string): number | string => {
      switch (key) {
        case 'rank': return Number(bid.rank);
        case 'bidder': return String(bid.companyName);
        case 'base': return Number(bid.baseCents);
        case 'provisional': return Number(bid.provisionalSumsCents);
        case 'allowances': return Number(bid.allowancesCents);
        case 'exclusions': return Number(bid.pricedExclusionsCents);
        case 'levelled': return Number(bid.levelledTotalCents);
        case 'submitted': return Date.parse(String(bid.finalSubmittedAt));
        default: return 0;
      }
    };
    rows.sort((a, b) => {
      const valueA = sortValue(a, sortKey);
      const valueB = sortValue(b, sortKey);
      const comparison = typeof valueA === 'string' ? valueA.localeCompare(String(valueB)) : (valueA as number) - (valueB as number);
      return sortDir === 'asc' ? comparison : -comparison;
    });
    for (const bid of rows) {
      const row = h('tr');
      row.append(
        h('td', { text: String(bid.rank) }),
        h('td', { class: 'bidder-cell', text: `${String(bid.reference)} ${String(bid.companyName)}` }),
        h('td', { text: amountText(currency, Number(bid.baseCents)) }),
        h('td', { text: amountText(currency, Number(bid.provisionalSumsCents)) }),
        h('td', { text: amountText(currency, Number(bid.allowancesCents)) }),
        h('td', { text: amountText(currency, Number(bid.pricedExclusionsCents)) }),
        h('td', { text: amountText(currency, Number(bid.contingencyCents)) }),
        h('td', { text: amountText(currency, Number(bid.levelledTotalCents)) }),
        h('td', { text: instantText(String(bid.finalSubmittedAt), 'HK') }),
      );
      const actions = h('td', { class: 'row-actions' });
      const levelButton = h('button', {
        class: 'button-secondary',
        text: `Level ${String(bid.reference)}`,
        onclick: () => levelDialog(bid),
      });
      actions.append(levelButton);
      row.append(actions);
      tbody.append(row);
    }
    return Promise.resolve();
  }

  function levelDialog(bid: Record<string, unknown>): void {
    const allowancesContainer = h('div', {});
    const allowanceRows: { label: HTMLInputElement; amount: HTMLInputElement }[] = [];
    const addAllowance = (labelText?: string, amountCents?: number) => {
      const label = h('input', { type: 'text', class: 'input', value: labelText ?? '', 'aria-label': 'Allowance label' }) as HTMLInputElement;
      const amount = h('input', { type: 'text', class: 'input', inputmode: 'decimal', value: amountCents !== undefined ? (amountCents / 100).toFixed(2) : '', 'aria-label': 'Allowance amount' }) as HTMLInputElement;
      allowancesContainer.append(
        h('div', { class: 'allowance-row' },
          h('div', { class: 'field' }, h('label', { text: 'Allowance label' }), label),
          h('div', { class: 'field' }, h('label', { text: 'Allowance amount' }), amount)),
      );
      allowanceRows.push({ label, amount });
    };
    for (const allowance of (bid.allowances ?? []) as { label: string; amountCents: number }[]) {
      addAllowance(allowance.label, allowance.amountCents);
    }
    const addAllowanceButton = h('button', { type: 'button', class: 'button-quiet', text: 'Add allowance', onclick: () => addAllowance() });
    const exclusionRows: { id: string; label: string; input: HTMLInputElement }[] = [];
    const exclusionsContainer = h('div', {});
    for (const exclusion of (bid.exclusions ?? []) as { id: string; label: string; priceCents: number | null }[]) {
      const input = h('input', { type: 'text', class: 'input', inputmode: 'decimal', value: exclusion.priceCents !== null ? (exclusion.priceCents / 100).toFixed(2) : '' }) as HTMLInputElement;
      input.setAttribute('aria-label', `Price for ${exclusion.label}`);
      exclusionsContainer.append(h('div', { class: 'field' }, h('label', { text: `Price for ${exclusion.label}` }), input));
      exclusionRows.push({ id: exclusion.id, label: exclusion.label, input });
    }
    const save = h('button', { class: 'button-primary', type: 'submit', text: 'Save levelling' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          await api(`/api/bids/${bid.id}/levelling`, {
            method: 'PATCH',
            body: JSON.stringify({
              allowances: allowanceRows
                .filter((row) => row.label.value.trim())
                .map((row) => ({ label: row.label.value, amountCents: Math.round(parseFloat(row.amount.value || '0') * 100) })),
              exclusionPrices: exclusionRows.map((row) => ({ exclusionId: row.id, priceCents: Math.round(parseFloat(row.input.value || '0') * 100) })),
            }),
          });
          announce(`Levelling for ${String(bid.reference)} saved.`);
          dialogHandle.close();
          setFocusTarget(document.querySelector<HTMLElement>('[data-status-heading]'));
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (error) {
          save.disabled = false;
          save.textContent = 'Save levelling';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog(`Level ${String(bid.reference)}`, (container) => {
      form.append(allowancesContainer, addAllowanceButton, exclusionsContainer, h('div', { class: 'form-actions' }, save));
      container.append(form);
    });
  }

  awardButton.addEventListener('click', () => {
    const radios: { radio: HTMLInputElement; bid: Record<string, unknown> }[] = [];
    const reasonInput = h('input', { type: 'text', id: 'field-reason', class: 'input' }) as HTMLInputElement;
    const confirm = h('button', {
      class: 'button-primary',
      text: 'Confirm award',
      onclick: async () => {
        const chosen = radios.find((entry) => entry.radio.checked);
        if (!chosen) return;
        confirm.disabled = true;
        confirm.textContent = 'Awarding…';
        try {
          await api(`/api/tenders/${tenderId}/award`, {
            method: 'POST',
            body: JSON.stringify({ bidId: chosen.bid.id, reason: reasonInput.value || undefined }),
          });
          announce(`Awarded to ${String(chosen.bid.companyName)}.`);
          dialogHandle.close();
          window.location.assign(`/office/tenders/${tenderId}`);
        } catch (error) {
          confirm.disabled = false;
          confirm.textContent = 'Confirm award';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              showFieldErrors(form, fieldErrorCopy(error));
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const form = h('form', { onsubmit: (event: Event) => event.preventDefault() });
    for (const bid of bids) {
      const radio = h('input', { type: 'radio', name: 'award-bid', id: `award-${bid.id}` }) as HTMLInputElement;
      radio.setAttribute('aria-label', `${String(bid.reference)} ${String(bid.companyName)}`);
      radios.push({ radio, bid });
      form.append(h('div', { class: 'radio-row' }, radio, h('label', { for: radio.id, text: `${String(bid.reference)} ${String(bid.companyName)}` })));
    }
    form.append(h('div', { class: 'field' }, h('label', { for: 'field-reason', text: 'Reason for not awarding the lowest' }), reasonInput), confirm);
    const dialogHandle = openDialog('Award tender', (container) => {
      container.append(form);
    });
  });

  main.append(
    h('div', { class: 'panel' },
      h('div', { class: 'levelling-controls' }, findBidder, unpricedSelect, exportLink, awardButton),
      table),
  );
  await renderRows();
  return main;
}
