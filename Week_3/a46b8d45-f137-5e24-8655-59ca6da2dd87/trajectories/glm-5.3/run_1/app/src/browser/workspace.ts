// Operator screens continued: the claim workspace, imports and editions.
import { apiJson, el, navigate, render, setPendingStatus, text } from './app.js';
import { createFan, type FanModel, type FanPart } from './fan.js';
import type { ApiErrorShape, ClaimView, ModelSummary, ModelDetail } from './types.js';

export interface WorkspaceDeps {
  frame: HTMLElement;
  reference: string;
  alertRegion: HTMLElement;
  statusRegion: HTMLElement;
}

const STATE_LABELS: Record<string, string> = {
  started: 'Started', confirmed: 'Confirmed', identified: 'Identified',
  quoted: 'Quoted', declined: 'Declined', dispatched: 'Dispatched',
  closed: 'Closed', erased: 'Erased',
};

function operatorRefusal(err: ApiErrorShape['error']): string {
  const copy: Record<string, string> = {
    wrong_state: `This claim is ${err.state ? STATE_LABELS[err.state] ?? err.state : ''}, so that can't be done now.`,
    not_paid: 'Record the owner\'s payment before dispatch.',
    already_paid: 'This claim is already paid.',
    part_withdrawn: 'Part has been withdrawn.',
    idempotency_conflict: 'That request was already used for a different action.',
    billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
    carrier_unavailable: "The carrier isn't answering. No quote was made.",
    carrier_timeout: 'The carrier took too long to answer. No quote was made.',
    carrier_malformed: "The carrier's answer couldn't be read. No quote was made.",
    storage_unavailable: "File storage isn't answering. Nothing was changed.",
    mail_unavailable: "Email isn't answering. Nothing was erased.",
    database_unavailable: "The claim records aren't answering. Nothing was changed.",
    not_found: 'No claim with that reference.',
    bad_credentials: "That email and password don't match.",
    unauthenticated: 'Sign in to continue.',
    rate_limited: 'Too many requests. Please wait a moment.',
  };
  const found = copy[err.code];
  if (found === undefined) return err.message;
  return found;
}

function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join('').slice(0, 32);
}

/** Renders the claim workspace for the current state. The stage part of the
 * address only says which action brought the operator there. */
export async function renderWorkspace(
  frame: HTMLElement, reference: string, alertRegion: HTMLElement, statusRegion: HTMLElement, stagePath: string,
): Promise<void> {
  frame.appendChild(skipLinkOperator());
  const header = el('header', 'page-header');
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  const nav = el('nav', 'ops-nav');
  const claimsLink = el('a', 'ops-nav-link');
  claimsLink.href = '/ops/claims';
  text(claimsLink, 'All claims');
  nav.appendChild(claimsLink);
  header.appendChild(h);
  header.appendChild(nav);
  frame.appendChild(header);

  const main = el('main', 'workspace-page');
  main.id = 'main';
  frame.appendChild(main);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const view = await apiJson<ClaimView>(`/api/ops/claims/${encodeURIComponent(reference)}`);
  if (view.status !== 200) {
    text(alertRegion, operatorRefusal((view.body as ApiErrorShape).error));
    return;
  }
  const claim = view.body as ClaimView;

  const layout = el('div', 'workspace-layout');
  main.appendChild(layout);

  // Below 1280 px the queue pane is not rendered at all; from 1280 px it is a
  // real pane. A resize re-renders the workspace at the breakpoint.
  let queuePane: HTMLElement | null = null;
  const attachQueue = (): void => {
    const wide = window.innerWidth >= 1280;
    if (wide && queuePane === null) {
      queuePane = el('nav', 'workspace-queue');
      queuePane.setAttribute('aria-label', 'Claim queue');
      layout.insertBefore(queuePane, layout.firstChild);
      void fillQueuePane(queuePane);
    } else if (!wide && queuePane !== null) {
      queuePane.remove();
      queuePane = null;
    }
  };

  const fanPane = el('div', 'workspace-fan');
  const slipPane = el('div', 'workspace-slip');
  layout.appendChild(fanPane);
  layout.appendChild(slipPane);

  await drawWorkspace(claim, fanPane, slipPane, alertRegion, statusRegion, stagePath);
  attachQueue();
  window.addEventListener('resize', attachQueue);
}

/** Fills the queue pane with a small table of claims. */
async function fillQueuePane(queuePane: HTMLElement): Promise<void> {
  const queueRegion = el('div', 'table-region');
  queueRegion.setAttribute('role', 'region');
  queueRegion.setAttribute('aria-label', 'Claims');
  const queueTable = el('table', 'claims-table');
  queueTable.setAttribute('aria-label', 'Claims');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Reference', 'State']) {
    const th = el('th');
    text(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  queueTable.appendChild(thead);
  const tbody = el('tbody');
  queueTable.appendChild(tbody);
  queueRegion.appendChild(queueTable);
  queuePane.appendChild(queueRegion);

  const list = await apiJson<{ claims: Array<{ reference: string; state: string; confirmed_at: string | null }> }>('/api/ops/claims');
  if (list.status === 200) {
    for (const entry of (list.body as { claims: Array<{ reference: string; state: string }> }).claims.slice(0, 20)) {
      const tr = el('tr');
      const refCell = el('td');
      const link = el('a', 'claim-link mono');
      link.href = `/ops/claims/${entry.reference}`;
      text(link, entry.reference);
      refCell.appendChild(link);
      tr.appendChild(refCell);
      const stateCell = el('td');
      text(stateCell, entry.state);
      tr.appendChild(stateCell);
      tbody.appendChild(tr);
    }
  }
}

function skipLinkOperator(): HTMLElement {
  const a = el('a', 'skip-link');
  a.href = '#main';
  text(a, 'Skip to claim workspace');
  return a;
}

async function drawWorkspace(
  claim: ClaimView, fanPane: HTMLElement, slipPane: HTMLElement,
  alertRegion: HTMLElement, statusRegion: HTMLElement, stagePath: string,
): Promise<void> {
  fanPane.innerHTML = '';
  slipPane.innerHTML = '';

  // --- Fan: the operator scrubs and selects the claimed part. ---
  let modelDetail: ModelDetail | null = null;
  if (claim.model !== null) {
    const detail = await apiJson<ModelDetail>(`/api/models/${encodeURIComponent(claim.model.slug)}`);
    if (detail.status === 200) modelDetail = detail.body as ModelDetail;
  }
  const fanModel: FanModel = modelDetail === null
    ? { slug: '', name: claim.model?.name ?? '', axis: null }
    : { slug: modelDetail.slug, name: modelDetail.name, axis: modelDetail.axis };
  const parts: FanPart[] = modelDetail === null ? [] : modelDetail.parts.map((p) => ({
    bookletNumber: p.booklet_number,
    name: p.name,
    partNumber: p.part_number,
    status: p.status,
  }));
  let selectedPart: number | null = claim.part?.booklet_number ?? null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fan = createFan({
    model: fanModel,
    parts,
    selected: selectedPart,
    locked: false,
    initialSeparation: reducedMotion || selectedPart !== null ? 100 : 0,
    reducedMotion,
    strings: () => ({
      separateParts: 'Separate parts',
      fanHeading: 'Fitting fan',
      diagramUnavailable: 'Diagram unavailable — choose your part from the list',
      partsList: 'Parts in booklet order',
      partButton: (n: number, name: string) => `Part ${n}: ${name}`,
    }),
    onSelect: (bookletNumber: number) => {
      selectedPart = bookletNumber;
      fan.setSelected(bookletNumber);
    },
  });
  fan.root.setAttribute('aria-label', 'Fitting fan');
  fanPane.appendChild(fan.root);

  // --- Claim slip ---
  const slip = el('section', 'slip');
  slip.setAttribute('role', 'region');
  slip.setAttribute('aria-label', 'Claim slip');
  slipPane.appendChild(slip);

  const heading = el('h2', 'slip-heading');
  text(heading, `${claim.reference} — ${STATE_LABELS[claim.state] ?? claim.state}`);
  slip.appendChild(heading);

  const ownerBlock = el('p', 'slip-owner');
  text(ownerBlock, `${claim.owner.name} · ${claim.owner.email} · ${claim.owner.postcode}`);
  slip.appendChild(ownerBlock);

  if (claim.part !== null) {
    const partLine = el('p', 'slip-part');
    text(partLine, `Part ${claim.part.booklet_number}: ${claim.part.name}`);
    slip.appendChild(partLine);
    const partNumber = el('p', 'slip-part-number mono');
    text(partNumber, `Part number ${claim.part.part_number}`);
    slip.appendChild(partNumber);
    const binLine = el('p', 'slip-bin mono');
    text(binLine, `Bin ${claim.part.bin_count} · ${claim.part.status}`);
    slip.appendChild(binLine);
  }

  // Photos
  for (const photo of claim.photos) {
    const img = el('img', 'slip-photo');
    img.src = `/api/ops/claims/${encodeURIComponent(claim.reference)}/photos/${photo.index}`;
    img.alt = `Photo ${photo.index}`;
    slip.appendChild(img);
  }

  // Ruling with its edition.
  if (claim.ruling !== null) {
    const rulingLine = el('p', 'slip-ruling');
    text(rulingLine, claim.ruling.inside ? 'Inside aftercare' : 'Outside aftercare');
    slip.appendChild(rulingLine);
    const coverLine = el('p', 'slip-cover');
    const coverTime = claim.ruling.cover_ends_at.slice(11, 13) + ':' + claim.ruling.cover_ends_at.slice(14, 16);
    const coverDate = claim.ruling.cover_ends_on;
    const [y, m, d] = coverDate.split('-');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const shownDate = `${d} ${months[Number(m) - 1]} ${y}`;
    text(coverLine, `Cover until ${coverTime} on ${shownDate}`);
    slip.appendChild(coverLine);
    const editionLine = el('p', 'slip-edition mono');
    text(editionLine, `Ruled by edition ${claim.ruling.edition}`);
    slip.appendChild(editionLine);
    const editionCaption = el('p', 'source-caption mono');
    text(editionCaption, 'edition');
    slip.appendChild(editionCaption);
  }

  // Identify controls (allowed from confirmed).
  const identifyModel = el('select', 'combobox') as HTMLSelectElement;
  identifyModel.id = 'ops-model';
  identifyModel.setAttribute('aria-label', 'Model');
  const modelsResult = await apiJson<{ models: ModelSummary[] }>('/api/models');
  const modelOptions = (modelsResult.body as { models: ModelSummary[] }).models;
  for (const m of modelOptions) {
    const option = el('option') as HTMLOptionElement;
    option.value = m.slug;
    text(option, m.name);
    identifyModel.appendChild(option);
  }
  if (claim.model !== null) identifyModel.value = claim.model.slug;

  const quantityInput = el('input', 'spinbutton') as HTMLInputElement;
  quantityInput.type = 'number';
  quantityInput.min = '1';
  quantityInput.max = '20';
  quantityInput.value = String(claim.quantity ?? 1);
  quantityInput.id = 'ops-quantity';
  quantityInput.setAttribute('aria-label', 'Quantity');

  const identifyButton = el('button', 'button secondary');
  identifyButton.type = 'button';
  text(identifyButton, 'Identify part');

  const quoteButton = el('button', 'button primary');
  quoteButton.type = 'button';
  text(quoteButton, claim.quotes.length > 0 ? 'Re-quote' : 'Get quote');

  const paymentButton = el('button', 'button secondary');
  paymentButton.type = 'button';
  text(paymentButton, 'Record payment');

  const declineButton = el('button', 'button secondary');
  declineButton.type = 'button';
  text(declineButton, 'Decline');

  const dispatchButton = el('button', 'button primary');
  dispatchButton.type = 'button';
  text(dispatchButton, 'Dispatch');

  const closeButton = el('button', 'button secondary');
  closeButton.type = 'button';
  text(closeButton, 'Close claim');

  const withdrawLinkButton = el('button', 'button ghost');
  withdrawLinkButton.type = 'button';
  text(withdrawLinkButton, 'Withdraw share link');

  const newLinkButton = el('button', 'button ghost');
  newLinkButton.type = 'button';
  text(newLinkButton, 'Send new share link');

  const eraseButton = el('button', 'button ghost');
  eraseButton.type = 'button';
  text(eraseButton, 'Erase owner data');

  // State machine: each control is enabled only in states that allow it.
  const state = claim.state;
  identifyButton.disabled = state !== 'confirmed';
  quoteButton.disabled = !(state === 'identified' || (state === 'quoted' && claim.payment === null));
  if (claim.payment !== null) quoteButton.disabled = true;
  paymentButton.disabled = state !== 'quoted' || claim.payment !== null;
  declineButton.disabled = state !== 'quoted';
  dispatchButton.disabled = !(state === 'quoted' && claim.payment !== null);
  closeButton.disabled = !(state === 'declined' || state === 'dispatched');
  const linkStates = ['confirmed', 'identified', 'quoted', 'declined', 'dispatched'];
  withdrawLinkButton.disabled = !linkStates.includes(state);
  newLinkButton.disabled = !linkStates.includes(state);
  eraseButton.disabled = state === 'erased';

  // Identify row.
  if (state === 'confirmed' || state === 'identified' || state === 'quoted'
    || state === 'declined' || state === 'dispatched' || state === 'closed') {
    slip.appendChild(identifyModel);
    slip.appendChild(quantityInput);
    slip.appendChild(identifyButton);
  }

  // Current quote revision and Earlier revisions disclosure.
  const currentQuote = claim.quotes.find((q) => q.status === 'current') ?? null;
  const voidQuotes = claim.quotes.filter((q) => q.status === 'void');
  if (currentQuote !== null) {
    const revisionHeading = el('h3', 'slip-revision-heading mono');
    text(revisionHeading, `Quote revision ${currentQuote.revision}`);
    slip.appendChild(revisionHeading);
    const partLine = el('p', 'slip-line');
    text(partLine, `Part £${(currentQuote.part_line_minor / 100).toFixed(2)}`);
    slip.appendChild(partLine);
    const partCaption = el('p', 'source-caption mono');
    text(partCaption, 'billing');
    slip.appendChild(partCaption);
    const carriageLine = el('p', 'slip-line');
    text(carriageLine, `Carriage, band ${currentQuote.band} £${(currentQuote.carriage_minor / 100).toFixed(2)}`);
    slip.appendChild(carriageLine);
    const carriageCaption = el('p', 'source-caption mono');
    text(carriageCaption, 'carrier');
    slip.appendChild(carriageCaption);
    const totalLine = el('p', 'slip-line slip-total');
    text(totalLine, `Total £${(currentQuote.total_minor / 100).toFixed(2)}`);
    slip.appendChild(totalLine);
    const totalCaption = el('p', 'source-caption mono');
    text(totalCaption, 'billing');
    slip.appendChild(totalCaption);
    const promiseLine = el('p', 'slip-promise');
    const [py, pm, pd] = currentQuote.promise.date.split('-');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const shownDate = `${pd} ${months[Number(pm) - 1]} ${py}`;
    if (currentQuote.promise.kind === 'same_day') {
      text(promiseLine, `Same-working-day dispatch: leaves the workshop on ${shownDate}`);
    } else {
      text(promiseLine, `Leaves the workshop by ${shownDate}`);
    }
    slip.appendChild(promiseLine);

    if (voidQuotes.length > 0) {
      let earlierOpen = false;
      const earlierButton = el('button', 'button ghost disclosure');
      earlierButton.type = 'button';
      earlierButton.setAttribute('aria-expanded', 'false');
      text(earlierButton, `Earlier revisions (${voidQuotes.length})`);
      earlierButton.addEventListener('click', () => {
        earlierOpen = !earlierOpen;
        earlierButton.setAttribute('aria-expanded', earlierOpen ? 'true' : 'false');
        voidList.classList.toggle('hidden', !earlierOpen);
      });
      slip.appendChild(earlierButton);
      const voidList = el('ul', 'void-list hidden');
      for (const q of voidQuotes) {
        const li = el('li', 'void-entry mono');
        text(li, `Revision ${q.revision} (void): Total £${(q.total_minor / 100).toFixed(2)}`);
        voidList.appendChild(li);
      }
      slip.appendChild(voidList);
    }
  }

  if (claim.payment !== null) {
    const paidLine = el('p', 'slip-paid');
    text(paidLine, `Paid £${(claim.payment.paid_minor / 100).toFixed(2)}`);
    slip.appendChild(paidLine);
    const paidCaption = el('p', 'source-caption mono');
    text(paidCaption, 'billing');
    slip.appendChild(paidCaption);
  }

  if (claim.decline !== null) {
    const declineLine = el('p', 'slip-decline');
    if (claim.decline.refunded_minor > 0) {
      text(declineLine, `Refunded £${(claim.decline.refunded_minor / 100).toFixed(2)}`);
    } else {
      text(declineLine, 'Nothing charged');
    }
    slip.appendChild(declineLine);
    const caption = el('p', 'source-caption mono');
    text(caption, 'billing');
    slip.appendChild(caption);
  }

  // Share link.
  const shareLink = el('a', 'share-link mono');
  shareLink.href = claim.share_link.url;
  text(shareLink, claim.share_link.url);
  slip.appendChild(shareLink);

  if (claim.dispatched_at !== null) {
    const noteLink = el('a', 'button ghost');
    noteLink.href = `/api/ops/claims/${encodeURIComponent(claim.reference)}/dispatch-note`;
    text(noteLink, 'Dispatch note');
    slip.appendChild(noteLink);
  }

  // Action buttons.
  slip.appendChild(quoteButton);
  slip.appendChild(paymentButton);
  slip.appendChild(declineButton);
  slip.appendChild(dispatchButton);
  slip.appendChild(closeButton);
  slip.appendChild(withdrawLinkButton);
  slip.appendChild(newLinkButton);
  slip.appendChild(eraseButton);

  // --- Actions ---
  const act = async (
    button: HTMLButtonElement, path: string, body: unknown, key: boolean,
    done: (ok: boolean, response: { status: number; body: ClaimView | ApiErrorShape }) => Promise<void>,
  ): Promise<void> => {
    button.disabled = true;
    text(statusRegion, 'Working…');
    text(alertRegion, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers['Idempotency-Key'] = newIdempotencyKey();
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body ?? {}), credentials: 'same-origin' });
    const textBody = await res.text();
    let parsed: ClaimView | ApiErrorShape;
    try {
      parsed = JSON.parse(textBody) as ClaimView | ApiErrorShape;
    } catch {
      parsed = { error: { code: 'bad_json', message: textBody } };
    }
    button.disabled = false;
    text(statusRegion, '');
    const ok = res.status === 200 || res.status === 201;
    await done(ok, { status: res.status, body: parsed });
  };

  identifyButton.addEventListener('click', () => {
    void act(identifyButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/identify`, {
      model: identifyModel.value,
      booklet_number: selectedPart,
      quantity: quantityInput.value,
    }, false, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      const view = response.body as ClaimView;
      const ruling = view.ruling;
      setPendingStatus(ruling !== null
        ? `Part identified. Ruled by edition ${ruling.edition}.`
        : 'Part identified.');
      navigate(`/ops/claims/${claim.reference}/quote`);
    });
  });

  quoteButton.addEventListener('click', () => {
    void act(quoteButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/quote`, {}, true, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      const view = response.body as ClaimView;
      const current = view.quotes.find((q) => q.status === 'current');
      setPendingStatus(`Quote revision ${current?.revision ?? 1} recorded in billing.`);
      navigate(`/ops/claims/${claim.reference}/quote/${current?.revision ?? 1}`);
    });
  });

  paymentButton.addEventListener('click', () => {
    void act(paymentButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/payment`, {}, true, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      const view = response.body as ClaimView;
      const paid = view.payment?.paid_minor ?? 0;
      text(statusRegion, `Payment of £${(paid / 100).toFixed(2)} recorded in billing.`);
      render();
    });
  });

  dispatchButton.addEventListener('click', () => {
    void act(dispatchButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/dispatch`, {}, true, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      setPendingStatus('Dispatched. Dispatch note stored.');
      navigate(`/ops/claims/${claim.reference}/dispatched`);
    });
  });

  closeButton.addEventListener('click', () => {
    void act(closeButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/close`, {}, false, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      setPendingStatus('Claim closed.');
      navigate(`/ops/claims/${claim.reference}`);
    });
  });

  withdrawLinkButton.addEventListener('click', async () => {
    withdrawLinkButton.disabled = true;
    const res = await fetch(`/api/ops/claims/${encodeURIComponent(claim.reference)}/share-link`, { method: 'DELETE', credentials: 'same-origin' });
    withdrawLinkButton.disabled = false;
    if (res.status === 204) {
      text(statusRegion, 'Share link withdrawn.');
      render();
    } else {
      const parsed = await res.json() as ApiErrorShape;
      text(alertRegion, operatorRefusal(parsed.error));
    }
  });

  newLinkButton.addEventListener('click', () => {
    void act(newLinkButton, `/api/ops/claims/${encodeURIComponent(claim.reference)}/share-link`, {}, false, async (ok, response) => {
      if (!ok) {
        text(alertRegion, operatorRefusal((response.body as ApiErrorShape).error));
        return;
      }
      text(statusRegion, 'New share link created.');
      render();
    });
  });

  // --- Decline dialog ---
  let declineDialog: HTMLDialogElement | null = null;
  declineButton.addEventListener('click', () => {
    declineDialog = openDeclineDialog(claim, async (reason) => {
      if (declineDialog === null) return;
      declineDialog.close();
      declineDialog = null;
      declineButton.disabled = true;
      text(statusRegion, 'Working…');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': newIdempotencyKey(),
      };
      const res = await fetch(`/api/ops/claims/${encodeURIComponent(claim.reference)}/decline`, {
        method: 'POST', headers, body: JSON.stringify({ reason }), credentials: 'same-origin',
      });
      declineButton.disabled = false;
      text(statusRegion, '');
      if (res.status === 200) {
        setPendingStatus('Claim declined.');
        navigate(`/ops/claims/${claim.reference}/declined`);
      } else {
        const parsed = await res.json() as ApiErrorShape;
        text(alertRegion, operatorRefusal(parsed.error));
      }
    });
  });

  // --- Erase dialog ---
  eraseButton.addEventListener('click', () => {
    openEraseDialog(claim, async () => {
      eraseButton.disabled = true;
      text(statusRegion, 'Working…');
      const res = await fetch(`/api/ops/claims/${encodeURIComponent(claim.reference)}/erase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_reference: claim.reference }),
        credentials: 'same-origin',
      });
      eraseButton.disabled = false;
      text(statusRegion, '');
      if (res.status === 200) {
        setPendingStatus('Owner data erased.');
        navigate(`/ops/claims/${claim.reference}`);
      } else {
        const parsed = await res.json() as ApiErrorShape;
        text(alertRegion, operatorRefusal(parsed.error));
      }
    });
  });

  void stagePath;
}

/** The Decline claim dialog. Focus moves to its first control; Tab wraps
 * inside; Escape or Cancel closes it without acting. */
function openDeclineDialog(claim: ClaimView, onConfirm: (reason: string) => void): HTMLDialogElement {
  const dialog = el('dialog', 'desk-dialog');
  dialog.setAttribute('aria-label', 'Decline claim');
  const form = el('form', 'dialog-form') as HTMLFormElement;
  const group = el('fieldset', 'dialog-radios');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Reason');
  const legend = el('legend', 'visually-hidden');
  text(legend, 'Reason');
  group.appendChild(legend);
  let chosen = 'owner_declined';
  for (const [value, label] of [['owner_declined', 'Owner declined the quote'], ['cannot_send', 'Part cannot be sent']] as const) {
    const radio = el('input', 'dialog-radio') as HTMLInputElement;
    radio.type = 'radio';
    radio.name = 'reason';
    radio.value = value;
    radio.id = `reason-${value}`;
    radio.checked = value === 'owner_declined';
    const radioLabel = el('label', 'dialog-radio-label');
    radioLabel.htmlFor = `reason-${value}`;
    text(radioLabel, label);
    group.appendChild(radio);
    group.appendChild(radioLabel);
  }
  group.addEventListener('change', () => {
    chosen = (group.querySelector('input:checked') as HTMLInputElement | null)?.value ?? 'owner_declined';
  });

  const confirmButton = el('button', 'button primary');
  confirmButton.type = 'button';
  text(confirmButton, 'Confirm decline');
  const cancelButton = el('button', 'button secondary');
  cancelButton.type = 'button';
  text(cancelButton, 'Cancel');

  form.appendChild(group);
  form.appendChild(confirmButton);
  form.appendChild(cancelButton);
  dialog.appendChild(form);
  document.body.appendChild(dialog);

  // Focus never leaves an open dialog: Tab from the last control wraps to the
  // first, and Shift+Tab from the first wraps back to the last.
  const focusables = (): HTMLElement[] => {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hasAttribute('disabled'));
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0] as HTMLElement;
    const last = list[list.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    }
  });

  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => {
    // From the moment the dialog is closed, nothing in it can take focus.
    dialog.close();
    dialog.remove();
    (opener ?? document.body).focus();
  };
  cancelButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  });
  confirmButton.addEventListener('click', () => {
    onConfirm(chosen);
  });
  dialog.showModal();
  (group.querySelector('input') as HTMLInputElement).focus();
  return dialog;
}

/** The Erase owner data dialog: the typed reference must equal the claim
 * reference exactly as issued. */
function openEraseDialog(claim: ClaimView, onConfirm: () => void): void {
  const dialog = el('dialog', 'desk-dialog');
  dialog.setAttribute('aria-label', 'Erase owner data');
  const form = el('form', 'dialog-form') as HTMLFormElement;
  const label = el('label', 'field-label dialog-label');
  text(label, 'Type the reference to confirm');
  const input = el('input', 'textbox mono') as HTMLInputElement;
  input.type = 'text';
  input.id = 'erase-confirm';
  input.setAttribute('aria-label', 'Type the reference to confirm');
  label.htmlFor = 'erase-confirm';

  const confirmButton = el('button', 'button primary');
  confirmButton.type = 'button';
  text(confirmButton, 'Erase everything');
  const cancelButton = el('button', 'button secondary');
  cancelButton.type = 'button';
  text(cancelButton, 'Cancel');

  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(confirmButton);
  form.appendChild(cancelButton);
  dialog.appendChild(form);
  document.body.appendChild(dialog);

  // Focus never leaves an open dialog: the Tab order wraps inside it.
  const focusables = (): HTMLElement[] => {
    return Array.from(dialog.querySelectorAll<HTMLElement>(
      'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
    )).filter((node) => !node.hasAttribute('disabled'));
  };
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (list.length === 0) return;
    const first = list[0] as HTMLElement;
    const last = list[list.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    }
  });

  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => {
    dialog.close();
    dialog.remove();
    (opener ?? document.body).focus();
  };
  input.addEventListener('input', () => {
    confirmButton.disabled = input.value !== claim.reference;
  });
  confirmButton.disabled = true;
  cancelButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  confirmButton.addEventListener('click', () => {
    close();
    onConfirm();
  });
  dialog.showModal();
  input.focus();
}

export async function renderImportsPage(
  frame: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement,
): Promise<void> {
  frame.appendChild(skipLinkOperator());
  const header = el('header', 'page-header');
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  header.appendChild(h);
  frame.appendChild(header);
  const main = el('main', 'imports-page');
  main.id = 'main';
  frame.appendChild(main);
  const heading = el('h2', 'page-heading');
  text(heading, 'Supplier parts import');
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const form = el('form', 'import-form') as HTMLFormElement;
  const fileInput = el('input', 'file-input') as HTMLInputElement;
  fileInput.type = 'file';
  fileInput.accept = 'text/csv';
  fileInput.id = 'import-file';
  fileInput.setAttribute('aria-label', 'Supplier parts file');
  const fileLabel = el('label', 'field-label');
  text(fileLabel, 'Supplier parts file');
  fileLabel.htmlFor = 'import-file';
  const submit = el('button', 'button primary');
  submit.type = 'submit';
  text(submit, 'Import file');
  form.appendChild(fileLabel);
  form.appendChild(fileInput);
  form.appendChild(submit);
  main.appendChild(form);

  const report = el('div', 'import-report');
  main.appendChild(report);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    submit.disabled = true;
    text(statusRegion, 'Working…');
    void file.arrayBuffer().then((buffer) => {
      const body = new Uint8Array(buffer);
      return fetch('/api/ops/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body,
        credentials: 'same-origin',
      });
    }).then(async (res) => {
      submit.disabled = false;
      text(statusRegion, '');
      report.innerHTML = '';
      if (res.status !== 200) {
        const parsed = await res.json() as ApiErrorShape;
        text(alertRegion, parsed.error.message);
        return;
      }
      text(alertRegion, '');
      const parsed = await res.json() as { created: number; updated: number; unchanged: number; unmatched: Array<{ line: number; reason: string }> };
      text(statusRegion, `Imported: ${parsed.created} new, ${parsed.updated} updated, ${parsed.unchanged} unchanged, ${parsed.unmatched.length} unmatched.`);
      if (parsed.unmatched.length > 0) {
        const region = el('div', 'table-region');
        region.setAttribute('role', 'region');
        region.setAttribute('aria-label', 'Unmatched rows');
        const table = el('table', 'unmatched-table');
        table.setAttribute('aria-label', 'Unmatched rows');
        const thead = el('thead');
        const headRow = el('tr');
        for (const label of ['Line', 'Reason']) {
          const th = el('th');
          text(th, label);
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const row of parsed.unmatched) {
          const tr = el('tr');
          const lineCell = el('td', 'mono');
          text(lineCell, String(row.line));
          tr.appendChild(lineCell);
          const reasonCell = el('td', 'mono');
          text(reasonCell, row.reason);
          tr.appendChild(reasonCell);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        region.appendChild(table);
        report.appendChild(region);
      }
    });
  });
}

export async function renderEditionsPage(
  frame: HTMLElement, alertRegion: HTMLElement, statusRegion: HTMLElement,
): Promise<void> {
  frame.appendChild(skipLinkOperator());
  const header = el('header', 'page-header');
  const h = el('h1', 'brand');
  text(h, 'Holmgarth Aftercare');
  header.appendChild(h);
  frame.appendChild(header);
  const main = el('main', 'editions-page');
  main.id = 'main';
  frame.appendChild(main);
  const heading = el('h2', 'page-heading');
  text(heading, 'Aftercare editions');
  main.appendChild(heading);
  main.appendChild(alertRegion);
  main.appendChild(statusRegion);

  const form = el('form', 'edition-form') as HTMLFormElement;
  const codeInput = el('input', 'textbox mono') as HTMLInputElement;
  codeInput.type = 'text';
  codeInput.id = 'edition-code';
  codeInput.setAttribute('aria-label', 'Edition code');
  const codeLabel = el('label', 'field-label');
  text(codeLabel, 'Edition code');
  codeLabel.htmlFor = 'edition-code';
  const titleInput = el('input', 'textbox') as HTMLInputElement;
  titleInput.type = 'text';
  titleInput.id = 'edition-title';
  titleInput.setAttribute('aria-label', 'Title');
  const titleLabel = el('label', 'field-label');
  text(titleLabel, 'Title');
  titleLabel.htmlFor = 'edition-title';
  const startsInput = el('input', 'date-input') as HTMLInputElement;
  startsInput.type = 'date';
  startsInput.id = 'edition-starts';
  startsInput.setAttribute('aria-label', 'Starts on');
  const startsLabel = el('label', 'field-label');
  text(startsLabel, 'Starts on');
  startsLabel.htmlFor = 'edition-starts';
  const standardInput = el('input', 'spinbutton') as HTMLInputElement;
  standardInput.type = 'number';
  standardInput.min = '1';
  standardInput.max = '120';
  standardInput.value = '24';
  standardInput.id = 'edition-standard';
  standardInput.setAttribute('aria-label', 'Standard months');
  const standardLabel = el('label', 'field-label');
  text(standardLabel, 'Standard months');
  standardLabel.htmlFor = 'edition-standard';
  const clubInput = el('input', 'spinbutton') as HTMLInputElement;
  clubInput.type = 'number';
  clubInput.min = '1';
  clubInput.max = '120';
  clubInput.value = '36';
  clubInput.id = 'edition-club';
  clubInput.setAttribute('aria-label', 'Club months');
  const clubLabel = el('label', 'field-label');
  text(clubLabel, 'Club months');
  clubLabel.htmlFor = 'edition-club';
  const percentInput = el('input', 'spinbutton') as HTMLInputElement;
  percentInput.type = 'number';
  percentInput.min = '0';
  percentInput.max = '100';
  percentInput.value = '25';
  percentInput.id = 'edition-percent';
  percentInput.setAttribute('aria-label', 'Owner contribution percent');
  const percentLabel = el('label', 'field-label');
  text(percentLabel, 'Owner contribution percent');
  percentLabel.htmlFor = 'edition-percent';
  const submit = el('button', 'button primary');
  submit.type = 'submit';
  text(submit, 'Save edition');

  form.appendChild(codeLabel);
  form.appendChild(codeInput);
  form.appendChild(titleLabel);
  form.appendChild(titleInput);
  form.appendChild(startsLabel);
  form.appendChild(startsInput);
  form.appendChild(standardLabel);
  form.appendChild(standardInput);
  form.appendChild(clubLabel);
  form.appendChild(clubInput);
  form.appendChild(percentLabel);
  form.appendChild(percentInput);
  form.appendChild(submit);
  main.appendChild(form);

  const listRegion = el('div', 'table-region');
  listRegion.setAttribute('role', 'region');
  listRegion.setAttribute('aria-label', 'Editions');
  const table = el('table', 'editions-table');
  table.setAttribute('aria-label', 'Editions');
  const thead = el('thead');
  const headRow = el('tr');
  for (const label of ['Code', 'Title', 'Starts on', 'Standard months', 'Club months', 'Owner contribution percent']) {
    const th = el('th');
    text(th, label);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);
  listRegion.appendChild(table);
  main.appendChild(listRegion);

  const load = async (): Promise<void> => {
    const res = await apiJson<{ editions: Array<{ code: string; title: string; starts_on: string; standard_months: number; club_months: number; owner_contribution_percent: number }> }>('/api/ops/editions');
    tbody.innerHTML = '';
    if (res.status !== 200) {
      text(alertRegion, (res.body as ApiErrorShape).error.message);
      return;
    }
    for (const edition of (res.body as { editions: Array<{ code: string; title: string; starts_on: string; standard_months: number; club_months: number; owner_contribution_percent: number }> }).editions) {
      const tr = el('tr');
      const cells = [edition.code, edition.title, edition.starts_on, String(edition.standard_months), String(edition.club_months), String(edition.owner_contribution_percent)];
      for (const value of cells) {
        const td = el('td');
        text(td, value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  };
  await load();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.disabled = true;
    text(statusRegion, 'Working…');
    text(alertRegion, '');
    void apiJson<unknown>('/api/ops/editions', {
      method: 'POST',
      body: JSON.stringify({
        code: codeInput.value,
        title: titleInput.value,
        starts_on: startsInput.value,
        standard_months: Number(standardInput.value),
        club_months: Number(clubInput.value),
        owner_contribution_percent: Number(percentInput.value),
      }),
    }).then(async ({ status, body }) => {
      submit.disabled = false;
      text(statusRegion, '');
      if (status === 201) {
        const code = codeInput.value;
        const [y, m, d] = startsInput.value.split('-');
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        text(statusRegion, `Edition ${code} saved. It rules claims confirmed from 00:00 on ${d} ${months[Number(m) - 1]} ${y}.`);
        await load();
        return;
      }
      const err = (body as ApiErrorShape).error;
      if (err.fields !== undefined) {
        if (err.fields['starts_on'] === 'must_be_future') {
          text(alertRegion, 'Choose a date after today.');
          return;
        }
      }
      if (err.code === 'edition_date_taken') text(alertRegion, 'An edition already starts on that date.');
      else if (err.code === 'edition_code_taken') text(alertRegion, 'That edition code is already used.');
      else text(alertRegion, err.message);
    });
  });
}
