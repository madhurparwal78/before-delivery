import { ok, request } from '../api.js';
import { copy, printChangeSentence, slides } from '../copy.js';
import { announce, focusWithoutScroll } from '../dom.js';
import { dayMonthYear, rupees } from '../format.js';
import { LinkKeeper, type LinkState } from '../links.js';
import type { NoticeDetail, NoticeVersion } from '../types.js';

export function renderNotice(root: HTMLElement, number: string): void {
  root.innerHTML = `
    <main class="notice-page">
      <p class="back"><a href="/">Back to the hoarding</a></p>
      <h1 data-notice-title>Notice ${number}</h1>
      <div role="status" aria-label="Print status" data-print-status></div>
      <div data-versions></div>
    </main>
  `;
  const versionsHolder = root.querySelector('[data-versions]') as HTMLElement;
  const printStatus = root.querySelector('[data-print-status]') as HTMLElement;
  const keepers = new Map<number, LinkKeeper>();
  const linkHolders = new Map<number, HTMLElement>();
  const openState = new Map<number, boolean>();
  const printStates = new Map<number, string>();
  const expired = new Set<number>();
  let first = true;

  async function load(): Promise<void> {
    const result = await request<NoticeDetail>('GET', `/api/notices/${encodeURIComponent(number)}`).catch(
      () => null,
    );
    if (result === null) return;
    if (result.status === 404) {
      root.innerHTML = `<div class="slide"><p class="slide-line">${slides.notFound.line}</p><p class="slide-note">${slides.notFound.note}</p></div>`;
      return;
    }
    if (!ok(result)) return;
    draw(result.body);
  }

  function draw(detail: NoticeDetail): void {
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.focusKey ?? null;
    versionsHolder.replaceChildren(
      ...detail.versions.map((version, index) => versionBlock(detail, version, index === 0)),
    );
    for (const version of detail.versions) {
      const known = printStates.get(version.version);
      if (!first && known !== undefined && known !== version.printState && version.printState !== 'pending') {
        announce(
          printStatus,
          printChangeSentence(detail.number, version.version, version.printState as 'printable' | 'failed'),
        );
      }
      printStates.set(version.version, version.printState);
    }
    first = false;
    if (focusedId !== null) {
      const again = versionsHolder.querySelector(`[data-focus-key="${focusedId}"]`) as HTMLElement | null;
      focusWithoutScroll(again);
    }
    const anyPending = detail.versions.some((version) => version.printState === 'pending');
    if (anyPending) window.setTimeout(() => void load(), 5_000);
  }

  function versionBlock(detail: NoticeDetail, version: NoticeVersion, newest: boolean): HTMLElement {
    const block = document.createElement('section');
    block.className = 'version';
    const isOpen = openState.get(version.version) ?? newest;

    if (!newest) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = `Version ${version.version}`;
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      toggle.dataset.focusKey = `version-${version.version}`;
      toggle.addEventListener('click', () => {
        openState.set(version.version, !(openState.get(version.version) ?? false));
        draw(detail);
        focusWithoutScroll(
          versionsHolder.querySelector(`[data-focus-key="version-${version.version}"]`) as HTMLElement,
        );
      });
      block.append(toggle);
    }

    const state = document.createElement('p');
    state.className = 'version-state';
    state.textContent = stateLabel(version);
    block.append(state);

    if (version.supersededBy !== null) {
      const superseded = document.createElement('p');
      superseded.textContent = `Superseded by version ${version.supersededBy}`;
      block.append(superseded);
    }

    const body = document.createElement('div');
    body.className = 'version-body';
    if (!isOpen) {
      body.hidden = true;
      body.setAttribute('aria-hidden', 'true');
    }

    const title = document.createElement('h2');
    title.textContent = version.title;
    const dates = document.createElement('p');
    dates.textContent = `Effective ${dayMonthYear(version.effectiveDate)}. Published ${dayMonthYear(
      version.publishedAt.slice(0, 10),
    )}.`;
    body.append(title, dates);
    if (version.reason !== null) {
      const reason = document.createElement('p');
      reason.textContent = version.reason;
      body.append(reason);
    }
    if (version.runOutUntil !== null) {
      const runOut = document.createElement('p');
      runOut.textContent = `Old wrappers allowed until ${dayMonthYear(version.runOutUntil)}`;
      body.append(runOut);
    }

    const table = document.createElement('table');
    table.setAttribute('aria-label', `Revised prices ${detail.number} version ${version.version}`);
    const head = document.createElement('tr');
    for (const header of ['Pack', 'Old MRP', 'Revised MRP', 'Kind']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = header;
      head.append(cell);
    }
    table.append(head);
    for (const row of version.rows) {
      const line = document.createElement('tr');
      for (const value of [
        row.name,
        `Rs ${rupees(row.oldMrpPaise)}`,
        `Rs ${rupees(row.revisedMrpPaise)}`,
        row.kind === 'sticker' ? 'Sticker' : 'New print',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        line.append(cell);
      }
      table.append(line);
    }
    body.append(table);

    const linkHolder = document.createElement('p');
    linkHolder.className = 'version-link';
    linkHolders.set(version.version, linkHolder);
    body.append(linkHolder);
    if (version.printState === 'pending') {
      linkHolder.textContent = copy.stillBeingPrinted;
    } else {
      let keeper = keepers.get(version.version);
      if (keeper === undefined) {
        keeper = new LinkKeeper(
          `/api/notices/${detail.number}/versions/${version.version}/link`,
          (linkState) => showLink(detail.number, version.version, linkState),
        );
        keepers.set(version.version, keeper);
        keeper.start();
      }
      showLink(detail.number, version.version, keeper.current());
    }

    block.append(body);
    return block;
  }

  function showLink(noticeNumber: string, version: number, linkState: LinkState): void {
    const holder = linkHolders.get(version);
    if (holder === undefined) return;
    if (linkState.kind === 'link') {
      const link = document.createElement('a');
      link.href = linkState.url;
      link.textContent = `Download notice ${noticeNumber} version ${version}`;
      link.dataset.focusKey = `download-${version}`;
      holder.replaceChildren(link);
      expired.delete(version);
      if (expired.size === 0 && printStatus.textContent === copy.expiredLink) printStatus.textContent = '';
      return;
    }
    if (linkState.kind === 'expired') {
      holder.textContent = '';
      expired.add(version);
      announce(printStatus, copy.expiredLink);
      return;
    }
    if (linkState.kind === 'storage') {
      holder.textContent = copy.storageOutage;
      announce(printStatus, copy.storageOutage);
      return;
    }
    if (linkState.kind === 'print-failed') {
      holder.textContent = copy.printOutage;
      announce(printStatus, copy.printOutage);
      return;
    }
    if (linkState.kind === 'pending') holder.textContent = copy.stillBeingPrinted;
  }

  function stateLabel(version: NoticeVersion): string {
    const print =
      version.printState === 'printable'
        ? 'Printable'
        : version.printState === 'failed'
          ? 'Print failed'
          : 'Print pending';
    return `${version.state === 'superseded' ? 'Superseded' : version.state === 'scheduled' ? 'Scheduled' : 'In effect'} · ${print}`;
  }

  void load();
  window.setInterval(() => void load(), 5_000);
}
