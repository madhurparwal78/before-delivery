import { request } from '../api';
import { confirmPasswordDialog } from '../dialogs';
import { el, focusElement, setText } from '../dom';
import { Refreshes, TENANT_MS } from '../refresh';
import { announce, heading, type Screen, type ScreenContext } from '../shell';
import * as copy from '../copy';
import { formatDateLabel, formatMoney } from '../../shared/format';
import type { DocumentRecord, PackDetail, TenantDetail } from '../../shared/types';

interface DocumentBlock {
  node: HTMLElement;
  cover: HTMLElement;
  fingerprint: HTMLElement;
  notices: HTMLElement;
  noticeStates: Map<string, string>;
}

interface PackBlock {
  node: HTMLElement;
  title: HTMLElement;
  balance: HTMLElement;
  status: HTMLElement;
  refundable: HTMLElement;
  button: HTMLButtonElement;
  outcome: HTMLElement;
  refundPending: boolean;
}

export async function mountTenantDetail(ctx: ScreenContext): Promise<Screen> {
  const tenantId = ctx.params.id ?? '';
  const refreshes = new Refreshes();
  const missing = el('p', { className: 'outcome-copy' });
  let level1: HTMLHeadingElement | null = null;
  let statusLine: HTMLElement | null = null;
  let approveButton: HTMLButtonElement | null = null;
  let documentsRegion: HTMLElement | null = null;
  let packsRegion: HTMLElement | null = null;
  const documentBlocks = new Map<string, DocumentBlock>();
  const packBlocks = new Map<string, PackBlock>();
  let detail: TenantDetail | null = null;

  const first = await request<TenantDetail>('GET', `/api/tenants/${tenantId}`);
  if (first.kind !== 'ok') {
    missing.textContent = copy.missingRecord;
    ctx.root.append(missing);
    if (first.kind === 'error' && first.status !== 401) announce(copy.missingRecord);
    return { unmount: () => refreshes.stop() };
  }
  detail = first.body;

  level1 = heading(detail.businessName);
  statusLine = el('p', { className: 'tenant-status' });
  documentsRegion = el('section', {
    className: 'documents-region',
    attrs: { role: 'region', 'aria-label': 'Documents' },
  });
  packsRegion = el('section', {
    className: 'packs-region',
    attrs: { role: 'region', 'aria-label': 'Packs' },
  });
  ctx.root.append(level1, statusLine, documentsRegion, packsRegion);
  focusElement(level1);

  const drawDocument = (document_: DocumentRecord): void => {
    const region = documentsRegion;
    if (region === null) return;
    let block = documentBlocks.get(document_.id);
    if (block === undefined) {
      const node = el('article', { className: 'document-row' });
      const type = el('p', { text: copy.documentTypeLabel(document_.kind), className: 'document-type' });
      const expiry = el('p', { text: formatDateLabel(document_.expiresOn), className: 'document-expiry' });
      const cover = el('p', { className: 'cover' });
      const fingerprint = el('p', { className: 'mono' });
      const notices = el('div', { className: 'notice-lines' });
      node.append(type, expiry, cover, fingerprint);
      if (document_.hasFile) {
        node.append(
          el('a', {
            text: 'Open',
            className: 'link',
            attrs: { href: `/api/documents/${document_.id}/file`, target: '_blank', rel: 'noreferrer' },
          }),
        );
        if (document_.contentType === 'image/png' || document_.contentType === 'image/jpeg') {
          node.append(
            el('img', {
              className: 'document-preview',
              attrs: {
                src: `/api/documents/${document_.id}/file`,
                alt: `${copy.documentTypeLabel(document_.kind)} preview`,
              },
            }),
          );
        }
      }
      node.append(notices);
      region.append(node);
      block = { node, cover, fingerprint, notices, noticeStates: new Map() };
      documentBlocks.set(document_.id, block);
    }
    setText(block.cover, copy.coverLabel(document_.coverState, document_.daysLeft));
    block.cover.className = `cover cover-${document_.coverState}`;
    setText(block.fingerprint, copy.fingerprintText(document_.sha256));

    const lines = new Map<string, string>();
    for (const notice of document_.notices) lines.set(notice.point, copy.noticeLine(notice));
    block.notices.textContent = '';
    for (const [point, line] of lines) {
      block.notices.append(
        el('p', {
          text: line,
          className: line.endsWith('Queued') ? 'notice-line queued-mark' : 'notice-line',
        }),
      );
      const previous = block.noticeStates.get(point);
      if (previous !== undefined && previous !== line && line.includes('Sent')) {
        announce(copy.noticeAnnouncement(document_.kind, point === 'seven_days' ? 'seven_days' : 'today'));
      }
      block.noticeStates.set(point, line);
    }
  };

  const refundPack = async (pack: PackDetail, block: PackBlock, expectedCents: number): Promise<void> => {
    block.refundPending = true;
    block.button.setAttribute('aria-disabled', 'true');
    block.outcome.textContent = copy.refundPack.pending;
    let result = await request<PackDetail>('POST', `/api/packs/${pack.id}/refund`, {
      body: { expectedCents },
    });
    if (result.kind === 'error' && result.status === 403 && result.error === 'reauth_required') {
      const dialogOutcome = await confirmPasswordDialog(block.button);
      if (dialogOutcome === 'closed') {
        block.refundPending = false;
        block.button.removeAttribute('aria-disabled');
        block.outcome.textContent = copy.refundPack.dialogClosed;
        announce(copy.refundPack.dialogClosed);
        return;
      }
      result = await request<PackDetail>('POST', `/api/packs/${pack.id}/refund`, {
        body: { expectedCents },
      });
    }
    block.refundPending = false;
    if (result.kind === 'stale') return;

    if (result.kind === 'ok') {
      await read();
      const message = copy.refundPack.success(result.body.refundedCents ?? expectedCents, detail?.businessName ?? '');
      block.outcome.textContent = message;
      announce(message);
      focusElement(block.title);
      return;
    }
    block.button.removeAttribute('aria-disabled');
    if (result.kind === 'network') {
      block.outcome.textContent = copy.generic;
      announce(copy.generic);
      return;
    }
    await read();
    const reread = packBlocks.get(pack.id) ?? block;
    let message = copy.generic;
    if (result.status === 412) {
      const fresh = detail?.packs.find((entry) => entry.id === pack.id);
      message = copy.refundPack.amountChanged(fresh?.refundableCents ?? expectedCents);
    } else if (result.error === 'pack_in_use') message = copy.refundPack.inUse;
    else if (result.error === 'pack_empty') message = copy.refundPack.empty;
    else if (result.error === 'invalid_transition') message = copy.refundPack.already;
    else if (result.error === 'billing_unavailable') message = copy.refundPack.billingDown;
    reread.outcome.textContent = message;
    announce(message);
    if (reread.node.contains(reread.button)) focusElement(reread.button);
    else focusElement(reread.title);
  };

  const drawPack = (pack: PackDetail, index: number): void => {
    const region = packsRegion;
    if (region === null) return;
    let block = packBlocks.get(pack.id);
    if (block === undefined) {
      const node = el('section', { className: 'pack-panel' });
      const title = el('h2', { className: 'pack-heading', attrs: { tabindex: '-1' } });
      const balance = el('p', { className: 'pack-balance' });
      const status = el('p', { className: 'pack-status' });
      const refundable = el('p', { className: 'pack-refundable' });
      const button = el('button', { className: 'button', attrs: { type: 'button' } });
      const outcome = el('p', { className: 'outcome-copy' });
      node.append(title, balance, status, refundable, button, outcome);
      region.append(node);
      block = { node, title, balance, status, refundable, button, outcome, refundPending: false };
      packBlocks.set(pack.id, block);
      button.addEventListener('click', () => {
        const current = packBlocks.get(pack.id);
        if (current === undefined || current.refundPending) return;
        if (button.getAttribute('aria-disabled') === 'true') return;
        const fresh = detail?.packs.find((entry) => entry.id === pack.id);
        void refundPack(pack, current, fresh?.refundableCents ?? pack.refundableCents);
      });
    }
    setText(block.title, copy.packHeading(pack.hours, index + 1));
    const parts = copy.balanceParts(pack.balanceMinutes, pack.purchasedMinutes, pack.heldMinutes);
    setText(block.balance, `${parts.base}${parts.hold}`);
    block.balance.classList.toggle('held-mark', pack.heldMinutes > 0);
    setText(block.status, pack.status === 'refunded' ? 'Refunded' : 'Active');
    const showRefund = pack.status === 'active' && pack.balanceMinutes > 0;
    if (showRefund) {
      setText(block.refundable, `Refundable now $${formatMoney(pack.refundableCents)}`);
      setText(block.button, `Refund ${pack.hours}-hour pack`);
      if (!block.node.contains(block.button)) block.node.insertBefore(block.button, block.outcome);
      if (!block.refundPending) block.button.removeAttribute('aria-disabled');
    } else {
      setText(
        block.refundable,
        pack.status === 'refunded' ? `Refunded $${formatMoney(pack.refundedCents ?? 0)}` : '',
      );
      block.button.remove();
    }
  };

  const approve = async (): Promise<void> => {
    if (approveButton === null) return;
    approveButton.setAttribute('aria-disabled', 'true');
    announce(copy.approveTenant.pending);
    const result = await request<TenantDetail>('POST', `/api/tenants/${tenantId}/approve`);
    approveButton.removeAttribute('aria-disabled');
    if (result.kind === 'stale') return;
    if (result.kind === 'ok') {
      await read();
      announce(copy.approveTenant.success(detail?.businessName ?? ''));
      focusElement(level1);
      return;
    }
    if (result.kind === 'network') {
      announce(copy.generic);
      return;
    }
    await read();
    if (result.error === 'documents_not_valid') {
      announce(copy.approveTenant.lapsed(detail?.businessName ?? ''));
      return;
    }
    announce(copy.generic);
  };

  async function read(): Promise<void> {
    const result = await request<TenantDetail>('GET', `/api/tenants/${tenantId}`);
    if (result.kind !== 'ok') return;
    detail = result.body;
    if (level1 !== null) setText(level1, detail.businessName);
    if (statusLine !== null) {
      setText(statusLine, `Status: ${copy.tenantStatusLabel(detail.status, detail.suspendedReason)}`);
    }
    if (detail.status === 'documents_pending') {
      if (approveButton === null) {
        approveButton = el('button', { className: 'button primary', attrs: { type: 'button' } });
        approveButton.addEventListener('click', () => {
          void approve();
        });
        statusLine?.after(approveButton);
      }
      setText(approveButton, `Approve ${detail.businessName}`);
    } else {
      approveButton?.remove();
      approveButton = null;
    }

    const seenDocuments = new Set<string>();
    for (const document_ of detail.documents) {
      drawDocument(document_);
      seenDocuments.add(document_.id);
    }
    for (const [id, block] of documentBlocks) {
      if (!seenDocuments.has(id)) {
        block.node.remove();
        documentBlocks.delete(id);
      }
    }

    const seenPacks = new Set<string>();
    for (const [index, pack] of detail.packs.entries()) {
      drawPack(pack, index);
      seenPacks.add(pack.id);
    }
    for (const [id, block] of packBlocks) {
      if (!seenPacks.has(id)) {
        block.node.remove();
        packBlocks.delete(id);
      }
    }
  }

  await read();
  refreshes.every(TENANT_MS, () => {
    void read();
  });

  return {
    unmount: () => {
      refreshes.stop();
    },
  };
}
