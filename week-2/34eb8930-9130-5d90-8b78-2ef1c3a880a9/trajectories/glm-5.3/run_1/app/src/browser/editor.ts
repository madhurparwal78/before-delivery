import { h, announce, openDialog, openAlertDialog, fmtDate, roleLabel, trapFocus } from './lib/dom.js';
import { api, type PersonObject, type SessionPerson, type Snapshot, type SnapshotComment, type SnapshotSuggestion } from './lib/api.js';
import { socket, startHeartbeat, type ServerFrame } from './lib/socket.js';
import { createPage, PageModel, type CardPerson, type UICard, type PageView } from './page.js';
import { applyOpFrame } from '../domain/suggest.js';
import type { Op, BlockStyle, MarkType } from '../domain/ot.js';
import { wordStart, wordEnd } from '../domain/ot.js';
import type { Mode } from '../domain/types.js';

type Role = 'owner' | 'editor' | 'commenter' | 'viewer';

const ACCESS_ENDED_COPY: Record<string, string> = {
  expired: 'Your access ended at the time the owner set.',
  removed: 'The owner removed your access.',
  deleted: 'The owner deleted this proposal.',
};

const ALLOWED: Record<Role, Mode[]> = {
  owner: ['editing', 'suggesting', 'viewing'],
  editor: ['editing', 'suggesting', 'viewing'],
  commenter: ['suggesting', 'viewing'],
  viewer: ['viewing'],
};

export function mountEditor(documentId: string, me: SessionPerson, onSignedOut: () => void): void {
  void onSignedOut;
  document.body.innerHTML = '';
  const root = h('div', { class: 'editor-page' });
  const announcements = h('div', { class: 'visually-hidden', role: 'status', 'aria-label': 'Announcements', 'aria-live': 'polite' });
  document.body.append(root, announcements);

  const state = {
    documentId,
    me,
    role: 'owner' as Role,
    mode: 'editing' as Mode,
    accessEndsAt: null as string | null,
    revision: 0,
    connected: true,
    readOnly: false,
    people: [] as PersonObject[],
    showResolved: false,
    findQuery: null as string | null,
    matchCase: false,
    title: '',
    client: '',
    loadedOnce: false,
  };

  const pageModel = new PageModel();
  let page: PageView | null = null;
  let renderCtx: Parameters<typeof createPage>[0] | null = null;
  let refreshNoticesBadge: (() => void) | null = null;
  const markerNumbers = new Map<string, number>();
  /** ids of locally created suggestion records, replaced by the server's authoritative card */
  const tempSuggestionIds = new Set<string>();

  const isPhone = (): boolean => window.matchMedia('(max-width: 767px)').matches;

  window.addEventListener('resize', () => {
    layoutCards();
    applyPhoneLayout();
  });

  // ---------- banners and save status ----------
  const saveStatusEl = h('span', { role: 'status', 'aria-label': 'Save status', text: 'Saving' });
  const storageBanner = h('div', { class: 'banner', role: 'alert', style: 'display:none', text: "Your latest edits are not saved. Quillmere can't reach storage and is retrying." });
  const connectionBanner = h('div', { class: 'banner', role: 'alert', style: 'display:none', text: 'Connection lost. Reconnecting.' });

  function setSaveState(next: 'saved' | 'saving' | 'failed'): void {
    const label = next === 'saved' ? 'All changes saved' : next === 'saving' ? 'Saving' : 'Not saved';
    if (saveStatusEl.textContent !== label) {
      const isFirst = !state.loadedOnce;
      saveStatusEl.textContent = label;
      if (!isFirst) announce(label);
    }
    storageBanner.style.display = next === 'failed' ? '' : 'none';
  }

  const wordCountEl = h('span', {});
  function updateWordCount(): void {
    const n = pageModel.wordCount();
    wordCountEl.textContent = n === 1 ? '1 word' : `${n} words`;
  }

  // ---------- full-page screens ----------
  function showAccessEnded(reason: string): void {
    document.body.innerHTML = '';
    document.body.append(
      h('main', { class: 'message-screen' },
        h('h1', { text: 'This proposal is no longer available' }),
        h('div', { role: 'alert', text: ACCESS_ENDED_COPY[reason] ?? ACCESS_ENDED_COPY.expired! }),
        h('a', { href: '/', text: 'Back to documents' }),
      ),
    );
  }

  function showNotFound(): void {
    document.body.innerHTML = '';
    document.body.append(
      h('main', { class: 'message-screen' },
        h('h1', { text: 'Proposal not found' }),
        h('p', { text: "This proposal doesn't exist or isn't shared with you." }),
        h('a', { href: '/', text: 'Back to documents' }),
      ),
    );
  }

  function showStorageUnavailable(): void {
    document.body.innerHTML = '';
    document.body.append(
      h('main', { class: 'message-screen' },
        h('h1', { text: "This proposal can't be opened right now" }),
        h('p', { text: 'Storage is unreachable. Try again in a minute.' }),
        h('a', { href: '/', text: 'Back to documents' }),
      ),
    );
  }

  // ---------- cards from the snapshot ----------
  function cardsFromSnapshot(suggestions: SnapshotSuggestion[], comments: SnapshotComment[]): void {
    pageModel.model.suggestions = suggestions.filter((s) => s.status === 'open').map((s) => ({
      id: s.id,
      kind: s.kind,
      authorId: s.author.personId,
      authorRole: (s.author.role ?? 'editor') as Role,
      inserted: s.inserted,
      deleted: s.deleted,
      contentDeleted: s.contentDeleted,
      status: s.status as 'open' | 'accepted' | 'rejected',
      createdAt: s.createdAt,
      closedAt: null,
      closedById: null,
      closedAs: null,
      decidedById: null,
    }));
    pageModel.model.comments = comments.map((c) => ({
      id: c.id,
      authorId: c.author.personId,
      body: c.body,
      mentions: c.mentions.map((m) => m.personId),
      anchor: c.anchor,
      contentDeleted: c.contentDeleted,
      status: c.status as 'open' | 'resolved' | 'reopened',
      replies: c.replies.map((r) => ({ id: r.id, authorId: r.author.personId, body: r.body, createdAt: r.createdAt })),
      createdAt: c.createdAt,
    }));
    rebuildCards();
  }

  /** Cards are views over the model records, so their spans follow every edit. */
  function rebuildCards(): void {
    const roles = new Map(state.people.map((p) => [p.personId, p.role]));
    pageModel.cards = [
      ...pageModel.model.suggestions
        .filter((sug) => sug.status === 'open')
        .map((sug): UICard => ({
          kind: 'suggestion',
          id: sug.id,
          temp: pageModel.cards.some((c) => c.kind === 'suggestion' && c.id === sug.id && c.temp),
          author: personOf(sug.authorId) ?? { personId: sug.authorId, displayName: 'Unknown', colour: '#666666', role: roles.get(sug.authorId) ?? sug.authorRole },
          sug,
        })),
      ...pageModel.model.comments.map((c): UICard => ({
        kind: 'comment',
        id: c.id,
        author: personOf(c.authorId) ?? { personId: c.authorId, displayName: 'Unknown', colour: '#666666' },
        mentions: c.mentions.map((m) => personOf(m) ?? { personId: m, displayName: 'Unknown', colour: '#666666' }),
        ref: c,
      })),
    ];
  }

  function personOf(personId: string): CardPerson | null {
    const p = state.people.find((x) => x.personId === personId);
    return p ? { ...p } : null;
  }

  // ---------- permissions ----------
  const canEdit = (): boolean => !state.readOnly && state.connected && state.mode === 'editing' && (state.role === 'owner' || state.role === 'editor');
  const canSuggest = (): boolean => !state.readOnly && state.connected && state.mode === 'suggesting' && state.role !== 'viewer';
  const canDecide = (): boolean => state.role === 'owner' || state.role === 'editor';

  // ---------- ops ----------
  function sendFrame(mode: Mode, ops: Op[]): void {
    const frameMode: 'editing' | 'suggesting' = mode === 'viewing' ? 'suggesting' : mode;
    // optimistic local apply with the same domain code the server uses
    const outcome = applyOpFrame(pageModel.model, state.me.personId, state.role, frameMode, ops, pageModel.model.revision);
    if ('error' in outcome) return;
    for (const ev of outcome.delta.suggestionOps) {
      if ('created' in ev) {
        tempSuggestionIds.add(ev.created.id);
        pageModel.cards.push({
          kind: 'suggestion',
          id: ev.created.id,
          temp: true,
          author: { personId: state.me.personId, displayName: state.me.displayName, colour: state.me.colour, role: state.role },
          sug: pageModel.model.suggestions.find((x) => x.id === ev.created.id)!,
        });
      } else if ('changed' in ev) {
        // the local record was updated in place by applyOpFrame; nothing to sync
      }
    }
    for (const closedId of outcome.closedIds) {
      pageModel.model.suggestions = pageModel.model.suggestions.filter((x) => x.id !== closedId);
      pageModel.cards = pageModel.cards.filter((c) => c.id !== closedId);
    }
    rebuildCards();
    page?.render();
    renderCards();
    updateWordCount();
    restoreCaret();
    setSaveState('saving');
    const base = state.revision;
    state.revision += 1;
    void socket.send({ type: 'op', baseRevision: base, mode: frameMode, ops }).then((ack) => {
      if (ack.type === 'ack' && ack.revision !== undefined) state.revision = Math.max(state.revision, ack.revision);
    }).catch(() => {
      void reload();
    });
  }

  async function reload(): Promise<void> {
    try {
      const snap = await api.snapshot(documentId);
      applySnapshot(snap);
    } catch {
      // unreachable; keep the current state
    }
  }

  function applySnapshot(snap: Snapshot): void {
    state.role = snap.myAccess.role as Role;
    state.mode = snap.myAccess.mode;
    state.accessEndsAt = snap.myAccess.accessEndsAt;
    state.revision = snap.revision;
    state.title = snap.title;
    state.client = snap.client;
    pageModel.model.text = snap.text;
    pageModel.model.lineStyles = snap.blocks.map((b) => b.style as BlockStyle);
    pageModel.model.marks = snap.marks.map((m) => ({ type: m.type as MarkType, at: m.at, length: m.length, ...(m.href ? { href: m.href } : {}) }));
    pageModel.model.revision = snap.revision;
    cardsFromSnapshot(snap.suggestions, snap.comments);
    state.people = snap.people;
    setSaveState(snap.saveState);
    state.loadedOnce = true;
    page?.render();
    renderCards();
    updateWordCount();
    renderChrome();
  }

  // ---------- caret helpers ----------
  let lastCaretSent = 0;
  let pendingCaret = { at: 0, length: 0 };

  function caretOffset(): { at: number; length: number } {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !page) return { at: 0, length: 0 };
    const range = sel.getRangeAt(0);
    if (!page.container.contains(range.startContainer)) return { at: 0, length: 0 };
    const at = page.offsetOf(range.startContainer, range.startOffset);
    const length = page.offsetOf(range.endContainer, range.endOffset) - at;
    return { at, length };
  }

  function sendCaret(): void {
    const { at, length } = caretOffset();
    const now = Date.now();
    if (now - lastCaretSent > 120) {
      lastCaretSent = now;
      void socket.send({ type: 'caret', at, length }).catch(() => undefined);
    }
  }

  function setCaret(at: number, length = 0): void {
    if (!page) return;
    const pos = page.positionOf(at);
    const endPos = length > 0 ? page.positionOf(at + length) : null;
    const sel = window.getSelection();
    if (!sel || !pos) return;
    try {
      const range = document.createRange();
      range.setStart(pos.node, pos.offset);
      if (endPos) range.setEnd(endPos.node, endPos.offset);
      else range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // offsets can land on element boundaries right after a re-render
    }
  }

  function restoreCaret(): void {
    setCaret(pendingCaret.at, pendingCaret.length);
  }

  // ---------- chrome elements ----------
  const peopleList = h('ul', { class: 'people-chips', 'aria-label': 'People here' });
  const titleBox = h('span', {});
  const modeGroup = h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Mode' });
  const accessLabel = h('span', {});
  const shareButton = h<HTMLButtonElement>('button', { type: 'button', text: 'Share' });
  const outlinePanel = h('nav', { class: 'outline-rail', 'aria-label': 'Outline' });
  const marginEl = h('aside', { class: 'margin', role: 'complementary', 'aria-label': 'Margin' });
  const tetherSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  tetherSvg.setAttribute('aria-hidden', 'true');
  tetherSvg.style.position = 'absolute';
  tetherSvg.style.top = '0';
  tetherSvg.style.left = '0';
  tetherSvg.style.width = '1px';
  tetherSvg.style.height = '1px';
  tetherSvg.style.overflow = 'visible';
  tetherSvg.style.pointerEvents = 'none';
  tetherSvg.style.zIndex = '5';
  const toolbarEl = h('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Formatting' });
  const phoneToolbarButton = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Toolbar', text: 'Menu', style: 'display:none' });
  const phoneSheetButton = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Comments and suggestions', text: 'Cards', style: 'display:none' });
  const showResolvedToggle = h<HTMLInputElement>('input', { type: 'checkbox', id: 'show-resolved' }) as HTMLInputElement;

  function allowedModes(): Mode[] {
    return ALLOWED[state.role];
  }

  function setMode(mode: Mode): void {
    if (!allowedModes().includes(mode)) return;
    state.mode = mode;
    renderModeSwitch();
    renderToolbar();
    page?.render();
    void socket.send({ type: 'mode', mode }).catch(() => undefined);
  }

  function renderModeSwitch(): void {
    modeGroup.textContent = '';
    for (const mode of ['editing', 'suggesting', 'viewing'] as Mode[]) {
      const allowed = allowedModes().includes(mode);
      const id = `mode-${mode}`;
      const input = h<HTMLInputElement>('input', { type: 'radio', name: 'mode', id, value: mode, ...(state.mode === mode ? { checked: true } : {}), ...(allowed ? {} : { disabled: true }), ...(state.mode === mode ? {} : { tabindex: '-1' }) }) as HTMLInputElement;
      const label = h('label', { for: id, class: state.mode === mode ? 'on' : '' }, input, mode === 'editing' ? 'Editing' : mode === 'suggesting' ? 'Suggesting' : 'Viewing');
      modeGroup.append(label);
      input.addEventListener('change', () => {
        if (input.checked) setMode(mode);
      });
    }
    const checked = modeGroup.querySelector<HTMLInputElement>('input:checked');
    checked?.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const allowed = allowedModes();
      const idx = allowed.indexOf(state.mode);
      let next: Mode | null = null;
      if (ke.key === 'ArrowRight' || ke.key === 'ArrowDown') next = allowed[(idx + 1 + allowed.length) % allowed.length]!;
      else if (ke.key === 'ArrowLeft' || ke.key === 'ArrowUp') next = allowed[(idx - 1 + allowed.length) % allowed.length]!;
      else return;
      ke.preventDefault();
      setMode(next);
    });
  }

  // ---------- toolbar ----------
  const toolbarSyncFns: (() => void)[] = [];

  function selectionMarks(): { bold: boolean; italic: boolean; underline: boolean } {
    const { at, length } = caretOffset();
    const pos = length > 0 ? at : Math.max(0, at - 1);
    const end = length > 0 ? at + length - 1 : pos;
    const has = (type: MarkType): boolean => pageModel.model.marks.some((m) => m.type === type && m.at <= pos && m.at + m.length > end && m.at + m.length > pos);
    return { bold: has('bold'), italic: has('italic'), underline: has('underline') };
  }

  function paragraphStyle(): BlockStyle {
    const { at } = caretOffset();
    if (!page) return 'paragraph';
    const blocks = pageModel.blocks();
    return (blocks[page.lineIndexAt(at)]?.style as BlockStyle | undefined) ?? 'paragraph';
  }

  function applyStyle(style: BlockStyle): void {
    if (!canEdit()) return;
    const { at } = caretOffset();
    sendFrame('editing', [{ style, at }]);
  }

  function applyMark(mark: MarkType, value: boolean | string | null): void {
    if (!canEdit()) return;
    const { at, length } = caretOffset();
    const target = length > 0 ? at : Math.max(0, at - 1);
    const targetLen = Math.max(length, 1);
    sendFrame('editing', [{ mark, value, at: target, length: targetLen }]);
  }

  function renderToolbar(): void {
    toolbarEl.textContent = '';
    toolbarSyncFns.length = 0;
    const disabled = state.mode !== 'editing';
    const mkBtn = (label: string, pressed: () => boolean, onClick: () => void): HTMLButtonElement => {
      const btn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': label, text: label });
      const sync = (): void => {
        btn.setAttribute('aria-pressed', pressed() ? 'true' : 'false');
        btn.disabled = disabled;
      };
      btn.addEventListener('click', onClick);
      sync();
      toolbarSyncFns.push(sync);
      return btn;
    };
    const boldBtn = mkBtn('Bold', () => selectionMarks().bold, () => applyMark('bold', !selectionMarks().bold)) as HTMLButtonElement;
    const italicBtn = mkBtn('Italic', () => selectionMarks().italic, () => applyMark('italic', !selectionMarks().italic)) as HTMLButtonElement;
    const underlineBtn = mkBtn('Underline', () => selectionMarks().underline, () => applyMark('underline', !selectionMarks().underline)) as HTMLButtonElement;
    const linkBtn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Link', text: 'Link', onclick: () => openLinkDialog() }) as HTMLButtonElement;
    linkBtn.disabled = disabled;
    const styleSelect = h<HTMLSelectElement>('select', { 'aria-label': 'Paragraph style' },
      ...(['title', 'heading1', 'heading2', 'heading3', 'paragraph', 'bullet', 'numbered'] as BlockStyle[]).map((s) =>
        h('option', { value: s, text: s === 'heading1' ? 'Heading 1' : s === 'heading2' ? 'Heading 2' : s === 'heading3' ? 'Heading 3' : s === 'bullet' ? 'Bulleted item' : s === 'numbered' ? 'Numbered item' : s === 'title' ? 'Title' : 'Paragraph' }),
      ),
    ) as HTMLSelectElement;
    styleSelect.disabled = disabled;
    styleSelect.value = paragraphStyle();
    styleSelect.addEventListener('change', () => applyStyle(styleSelect.value as BlockStyle));
    toolbarSyncFns.push(() => {
      styleSelect.value = paragraphStyle();
    });
    const commentBtn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Comment', text: 'Comment', onclick: () => startComment() });
    const findBtn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Find and replace', text: 'Find', onclick: () => openFindDialog(findBtn) });
    const acceptAllBtn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Accept all', text: 'Accept all', onclick: () => confirmAll('accept', acceptAllBtn) }) as HTMLButtonElement;
    const rejectAllBtn = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Reject all', text: 'Reject all', onclick: () => confirmAll('reject', rejectAllBtn) }) as HTMLButtonElement;
    acceptAllBtn.disabled = !canDecide();
    rejectAllBtn.disabled = !canDecide();
    toolbarEl.append(boldBtn, italicBtn, underlineBtn, linkBtn, styleSelect, commentBtn, findBtn, acceptAllBtn, rejectAllBtn);
  }

  /** People here: one item per person with the proposal open (DP-08, presence). */
  function renderPeople(): void {
    peopleList.textContent = '';
    const here = new Map<string, PersonObject>();
    const me = state.people.find((p) => p.personId === state.me.personId) ?? { personId: state.me.personId, displayName: state.me.displayName, colour: state.me.colour, role: state.role };
    here.set(state.me.personId, me);
    for (const [pid, caret] of pageModel.carets) {
      here.set(pid, caret.person);
    }
    for (const person of here.values()) {
      peopleList.append(h('li', {},
        h('span', { class: 'chip', style: `background:${person.colour}`, 'aria-hidden': 'true' }),
        `${person.displayName} ${roleLabel(person.role ?? '')}`,
      ));
    }
  }

  function renderTitle(): void {
    titleBox.textContent = '';
    if (state.role === 'owner') {
      const input = h<HTMLInputElement>('input', { class: 'doc-title-input', 'aria-label': 'Proposal title', value: state.title }) as HTMLInputElement;
      input.addEventListener('change', async () => {
        try {
          await api.patchDocument(documentId, { title: input.value.trim() });
          state.title = input.value.trim();
        } catch {
          input.value = state.title;
        }
      });
      titleBox.append(input);
    } else {
      titleBox.append(h('h1', { class: 'doc-title', text: state.title }));
    }
  }

  function renderChrome(): void {
    renderTitle();
    renderPeople();
    renderModeSwitch();
    renderToolbar();
    renderOutline();
    renderCards();
    accessLabel.textContent = state.accessEndsAt ? `Access until ${fmtDate(state.accessEndsAt)}` : '';
    applyPhoneLayout();
  }

  // ---------- outline ----------
  function outlineEntries(): { text: string; at: number }[] {
    if (!page) return [];
    const blocks = pageModel.blocks();
    const lines = pageModel.model.text.split('\n');
    return blocks
      .map((b, i) => ({ style: b.style, at: b.at, line: lines[i] ?? '' }))
      .filter((b) => ['title', 'heading1', 'heading2', 'heading3'].includes(b.style))
      .map((b) => ({ text: b.line.trim(), at: b.at }));
  }

  function wireListbox(listbox: HTMLElement, options: HTMLElement[], onEnter: (idx: number) => void): void {
    let active = 0;
    listbox.tabIndex = 0;
    listbox.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowDown' || ke.key === 'ArrowUp') {
        ke.preventDefault();
        active = ke.key === 'ArrowDown' ? Math.min(active + 1, options.length - 1) : Math.max(active - 1, 0);
      } else if (ke.key === 'Home') {
        ke.preventDefault();
        active = 0;
      } else if (ke.key === 'End') {
        ke.preventDefault();
        active = Math.max(options.length - 1, 0);
      } else if (ke.key === 'Enter') {
        ke.preventDefault();
        onEnter(active);
        return;
      } else {
        return;
      }
      options.forEach((o, i) => o.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    });
    if (options[0]) options[0]!.setAttribute('aria-selected', 'true');
  }

  function renderOutline(): void {
    outlinePanel.textContent = '';
    outlinePanel.append(h('h2', { text: 'Outline' }));
    const listbox = h('ul', { role: 'listbox', 'aria-label': 'Headings', style: 'padding:0;list-style:none;margin:0' });
    const options: HTMLElement[] = [];
    const entries = outlineEntries();
    for (const entry of entries) {
      const opt = h('li', { role: 'option', 'aria-selected': 'false', tabindex: '-1', text: entry.text }) as HTMLElement;
      opt.addEventListener('click', () => jumpToHeading(entry.at));
      listbox.append(opt);
      options.push(opt);
    }
    wireListbox(listbox, options, (idx) => jumpToHeading(entries[idx]?.at ?? 0));
    outlinePanel.append(listbox);
  }

  function jumpToHeading(at: number): void {
    setCaret(at);
    page?.container.focus();
    const pos = page?.positionOf(at);
    (pos?.node.parentElement as HTMLElement | undefined)?.scrollIntoView?.({ block: 'center' });
  }

  // ---------- cards ----------
  function spanText(span: { at: number; length: number } | null): string {
    if (!span) return '';
    return pageModel.model.text.slice(span.at, span.at + span.length);
  }

  function suggestionCardText(card: Extract<UICard, { kind: 'suggestion' }>): string {
    if (card.sug.contentDeleted) return 'Original content deleted';
    if (card.sug.kind === 'insert') return `Insert “${spanText(card.sug.inserted)}”`;
    if (card.sug.kind === 'delete') return `Delete “${spanText(card.sug.deleted)}”`;
    return `Replace “${spanText(card.sug.deleted)}” with “${spanText(card.sug.inserted)}”`;
  }

  function sortedCards(): UICard[] {
    return [...pageModel.cards]
      .filter((c) => {
        if (c.kind === 'suggestion') return c.sug.status === 'open';
        if (c.ref.status === 'open' || c.ref.status === 'reopened') return true;
        return state.showResolved;
      })
      .sort((a, b) => {
        const sa = a.kind === 'suggestion' ? (a.sug.inserted ?? a.sug.deleted)?.at ?? 0 : (a.ref.anchor?.at ?? Number.MAX_SAFE_INTEGER);
        const sb = b.kind === 'suggestion' ? (b.sug.inserted ?? b.sug.deleted)?.at ?? 0 : (b.ref.anchor?.at ?? Number.MAX_SAFE_INTEGER);
        return sa - sb;
      });
  }

  let cardElements: { id: string; el: HTMLElement }[] = [];

  function renderCards(): void {
    if (!marginEl.isConnected) return;
    const focused = document.activeElement?.getAttribute('data-card-id');
    markerNumbers.clear();
    sortedCards().forEach((card, i) => markerNumbers.set(card.id, i + 1));
    marginEl.textContent = '';
    marginEl.append(h('label', { for: 'show-resolved', class: 'small-caps' }, showResolvedToggle, ' Show resolved'));
    cardElements = [];
    for (const card of sortedCards()) {
      const el = card.kind === 'suggestion' ? suggestionCard(card) : commentCard(card);
      cardElements.push({ id: card.id, el });
      marginEl.append(el);
    }
    if (focused) {
      marginEl.querySelector(`[data-card-id="${focused}"]`)?.setAttribute('tabindex', '0');
    }
    updatePhoneButton();
    layoutCards();
  }

  /** Cards sit level with the first line of their anchored range; tethers join them (DP-53). */
  function layoutCards(): void {
    if (!page || isPhone()) return;
    const marginRect = marginEl.getBoundingClientRect();
    const sheetRect = page.container.getBoundingClientRect();
    tetherSvg.textContent = '';
    let prevBottom = -8;
    for (const { id, el } of cardElements) {
      const anchorEl = page.container.querySelector(`[data-anchor-for="${id}"]`);
      let top: number | undefined;
      let rangeEnd: { x: number; y: number } | null = null;
      if (anchorEl) {
        const rects = anchorEl.getClientRects();
        const first = rects[0];
        const last = rects[rects.length - 1];
        if (first) top = first.top - marginRect.top;
        if (last) rangeEnd = { x: last.right, y: last.bottom - 2 };
      }
      if (top === undefined) top = prevBottom + 8;
      if (top < prevBottom + 8) top = prevBottom + 8;
      prevBottom = top + el.offsetHeight;
      el.style.position = 'relative';
      el.style.top = `${top}px`;
      el.style.marginBottom = '8px';
      if (rangeEnd) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('data-tether-for', id);
        line.setAttribute('x1', String(el.getBoundingClientRect().left - sheetRect.left));
        line.setAttribute('y1', String(el.getBoundingClientRect().top + 14 - sheetRect.top));
        line.setAttribute('x2', String(rangeEnd.x - sheetRect.left));
        line.setAttribute('y2', String(rangeEnd.y - sheetRect.top));
        const card = pageModel.cards.find((c) => c.id === id);
        const colour = card ? (card.kind === 'suggestion' ? card.author.colour : card.author.colour) : '#6b6455';
        line.setAttribute('stroke', colour);
        line.setAttribute('stroke-width', '1');
        tetherSvg.append(line);
      }
    }
  }

  function suggestionCard(card: Extract<UICard, { kind: 'suggestion' }>): HTMLElement {
    const person = card.author;
    const el = h('article', { class: 'card', 'aria-label': `Suggestion by ${person.displayName}`, 'data-card-id': card.id, tabindex: '0' },
      h('div', { class: 'card-head' },
        h('span', { class: 'chip', style: `background:${person.colour}`, 'aria-hidden': 'true' }),
        h('span', { class: 'card-author', text: `${person.displayName} · ${roleLabel(person.role ?? '')}` }),
      ),
      h('div', { class: 'card-body', text: suggestionCardText(card) }),
    );
    if (canDecide()) {
      const actions = h('div', { class: 'card-actions' });
      const accept = h<HTMLButtonElement>('button', { type: 'button', text: 'Accept', onclick: () => void decideCard(card.id, 'accept', accept) }) as HTMLButtonElement;
      const reject = h<HTMLButtonElement>('button', { type: 'button', text: 'Reject', onclick: () => void decideCard(card.id, 'reject', reject) }) as HTMLButtonElement;
      actions.append(accept, reject);
      el.append(actions);
    }
    wireCardKeys(el, card.id);
    return el;
  }

  function commentCard(card: Extract<UICard, { kind: 'comment' }>): HTMLElement {
    const person = card.author;
    const anchorText = card.ref.contentDeleted || !card.ref.anchor ? 'Original content deleted' : `“${spanText(card.ref.anchor)}”`;
    const replyInput = h<HTMLInputElement>('input', { type: 'text', 'aria-label': 'Reply', placeholder: 'Reply' }) as HTMLInputElement;
    const replyBtn = h<HTMLButtonElement>('button', { type: 'button', text: 'Reply', onclick: async () => {
      replyBtn.textContent = 'Posting';
      replyBtn.disabled = true;
      try {
        await api.addComment(documentId, { body: replyInput.value, mentions: [], parentId: card.id });
        announce('Reply posted');
        await reload();
      } catch {
        replyBtn.textContent = 'Reply';
        replyBtn.disabled = false;
      }
    } });
    const toggleBtn = h<HTMLButtonElement>('button', { type: 'button', text: card.ref.status === 'resolved' ? 'Reopen' : 'Resolve', onclick: async () => {
      try {
        if (card.ref.status === 'resolved') await api.reopenComment(documentId, card.id);
        else await api.resolveComment(documentId, card.id);
        announce(card.ref.status === 'resolved' ? 'Comment reopened' : 'Comment resolved');
      } catch {
        // 409: the card shows its current state with no announcement
      }
      await reload();
    } });
    const el = h('article', { class: 'card', 'aria-label': `Comment by ${person.displayName}`, 'data-card-id': card.id, tabindex: '0' },
      h('div', { class: 'card-head' },
        h('span', { class: 'chip', style: `background:${person.colour}`, 'aria-hidden': 'true' }),
        h('span', { class: 'card-author', text: `${person.displayName} · ${roleLabel(person.role ?? '')}` }),
      ),
      h('div', { class: 'card-body', text: card.ref.body }),
      h('div', { class: 'anchor-quote', text: anchorText }),
      ...card.ref.replies.map((r) => h('div', { class: 'reply' },
        h('div', { class: 'reply-author', text: personOf(r.authorId)?.displayName ?? 'Unknown' }),
        h('div', { text: r.body }),
      )),
      h('div', { class: 'card-actions' }, replyInput, replyBtn, toggleBtn),
    );
    wireCardKeys(el, card.id);
    return el;
  }

  function wireCardKeys(el: HTMLElement, id: string): void {
    el.addEventListener('focus', () => {
      for (const other of cardElements) other.el.classList.remove('focused');
      el.classList.add('focused');
    });
    el.addEventListener('blur', () => el.classList.remove('focused'));
    el.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && ke.target === el) {
        const card = pageModel.cards.find((c) => c.id === id);
        if (card && card.kind === 'suggestion' && canDecide()) {
          ke.preventDefault();
          void decideCard(id, 'accept', el);
        }
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        const card = pageModel.cards.find((c) => c.id === id);
        const at = card ? (card.kind === 'suggestion' ? (card.sug.inserted ?? card.sug.deleted)?.at ?? 0 : (card.ref.anchor?.at ?? 0)) : 0;
        setCaret(at);
        page?.container.focus();
      }
    });
  }

  async function decideCard(id: string, decision: 'accept' | 'reject', button: HTMLElement): Promise<void> {
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      const res = await api.decide(documentId, id, decision);
      if ((res as { applied?: boolean }).applied === false) {
        // another decision won first; the card disappears with no announcement
        await reload();
        return;
      }
      announce(decision === 'accept' ? 'Suggestion accepted' : 'Suggestion rejected');
      // apply the text change locally at once
      const card = pageModel.cards.find((c) => c.id === id);
      if (card && card.kind === 'suggestion') {
        if (decision === 'accept' && card.sug.deleted && !card.sug.contentDeleted) {
          pageModel.applyTextOps([{ del: card.sug.deleted.length, at: card.sug.deleted.at }]);
        } else if (decision === 'reject' && card.sug.inserted && !card.sug.contentDeleted) {
          pageModel.applyTextOps([{ del: card.sug.inserted.length, at: card.sug.inserted.at }]);
        }
      }
      pageModel.model.suggestions = pageModel.model.suggestions.filter((x) => x.id !== id);
      pageModel.cards = pageModel.cards.filter((c) => c.id !== id);
      state.revision = Math.max(state.revision, Number((res as { revision?: number }).revision ?? state.revision));
      page?.render();
      renderCards();
      updateWordCount();
      setSaveState('saving');
    } catch {
      await reload();
    }
  }

  function confirmAll(decision: 'accept' | 'reject', opener: HTMLElement): void {
    const openCount = pageModel.model.suggestions.filter((s) => s.status === 'open').length;
    const label = decision === 'accept' ? 'Accept all suggestions' : 'Reject all suggestions';
    openAlertDialog(
      label,
      h('p', { text: `${decision === 'accept' ? 'Accept' : 'Reject'} ${openCount} suggestion${openCount === 1 ? '' : 's'}?` }),
      decision === 'accept' ? 'Accept all' : 'Reject all',
      async () => {
        const res = await api.decideAll(documentId, decision);
        const count = (res as { count?: number }).count ?? 0;
        announce(count === 1 ? `1 suggestion ${decision === 'accept' ? 'accepted' : 'rejected'}` : `${count} suggestions ${decision === 'accept' ? 'accepted' : 'rejected'}`);
        await reload();
      },
      opener,
      decision === 'accept' ? 'Accepting' : 'Rejecting',
    );
  }

  // ---------- comments ----------
  let draftAnchor: { at: number; length: number } | null = null;

  function startComment(): void {
    const { at, length } = caretOffset();
    if (length < 1) {
      announce('Select the text this comment is about.');
      return;
    }
    draftAnchor = { at, length };
    renderDraftCard();
  }

  function renderDraftCard(): void {
    marginEl.querySelector('[data-draft="1"]')?.remove();
    if (!draftAnchor) return;
    const input = h<HTMLTextAreaElement>('textarea', { 'aria-label': 'Comment', placeholder: 'Comment' }) as HTMLTextAreaElement;
    const mentionBox = h('div', {});
    const post = h<HTMLButtonElement>('button', { type: 'button', class: 'primary', text: 'Post', onclick: async () => {
      post.textContent = 'Posting';
      post.disabled = true;
      const mentions = collectMentions(input.value);
      try {
        await api.addComment(documentId, { body: input.value, anchor: draftAnchor, mentions });
        announce('Comment posted');
        draftAnchor = null;
        await reload();
      } catch (err) {
        post.textContent = 'Post';
        post.disabled = false;
        const fields = (err as { fields?: Record<string, string> }).fields;
        if (fields?.body) {
          announce(fields.body);
          input.focus();
        }
      }
    } });
    const cancel = h<HTMLButtonElement>('button', { type: 'button', text: 'Cancel', onclick: () => {
      draftAnchor = null;
      marginEl.querySelector('[data-draft="1"]')?.remove();
      page?.container.focus();
    } });
    wireMentionPicker(input, mentionBox);
    const el = h('article', { class: 'card', 'data-draft': '1', 'aria-label': 'New comment' },
      h('div', { class: 'card-head' }, h('span', { class: 'card-author', text: `${state.me.displayName} · ${roleLabel(state.role)}` })),
      input,
      mentionBox,
      h('div', { class: 'card-actions' }, post, cancel),
    );
    marginEl.append(el);
    input.focus();
  }

  function collectMentions(body: string): string[] {
    return state.people.filter((p) => body.includes(`@${p.displayName}`)).map((p) => p.personId);
  }

  function wireMentionPicker(input: HTMLTextAreaElement, box: HTMLElement): void {
    let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
    input.addEventListener('input', () => {
      const value = input.value;
      const atIdx = value.lastIndexOf('@');
      keydownHandler?.(null as unknown as KeyboardEvent);
      box.textContent = '';
      if (atIdx === -1) return;
      // once the mention has a space after it, the pick is complete
      if (value.slice(atIdx + 1).includes(' ')) return;
      const query = value.slice(atIdx + 1).toLowerCase();
      const matches = state.people.filter((p) => p.displayName.toLowerCase().startsWith(query) && p.personId !== state.me.personId);
      if (matches.length === 0) return;
      const listbox = h('ul', { class: 'mention-listbox', role: 'listbox', 'aria-label': 'Mention people' });
      let active = 0;
      const options = matches.map((p, i) => {
        const li = h('li', { role: 'option', 'aria-selected': i === 0 ? 'true' : 'false', text: `${p.displayName} · ${roleLabel(p.role ?? '')}` });
        li.addEventListener('click', () => insert(p));
        listbox.append(li);
        return li;
      });
      const insert = (p: PersonObject): void => {
        input.value = `${value.slice(0, atIdx)}@${p.displayName} `;
        box.textContent = '';
        input.focus();
      };
      input.addEventListener('blur', () => {
        window.setTimeout(() => {
          box.textContent = '';
        }, 100);
      });
      keydownHandler = (e: KeyboardEvent | null): void => {
        if (!e) return;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          active = Math.min(active + 1, options.length - 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          active = Math.max(active - 1, 0);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          insert(matches[active]!);
          return;
        } else if (e.key === 'Escape') {
          box.textContent = '';
          return;
        } else {
          return;
        }
        options.forEach((o, i) => o.setAttribute('aria-selected', i === active ? 'true' : 'false'));
      };
      input.addEventListener('keydown', keydownHandler);
      box.append(listbox);
    });
  }

  // ---------- link dialog ----------
  function openLinkDialog(): void {
    const input = h<HTMLInputElement>('input', { type: 'url', 'aria-label': 'Link address', placeholder: 'https://…' }) as HTMLInputElement;
    openDialog((close) => h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Link' },
      h('h2', { text: 'Link' }),
      h('div', { class: 'field' }, h('label', { text: 'Link address' }), input),
      h('div', { class: 'row' },
        h<HTMLButtonElement>('button', { type: 'button', text: 'Cancel', onclick: close }),
        h<HTMLButtonElement>('button', { type: 'button', text: 'Remove link', onclick: () => {
          applyMark('link', null);
          close();
        } }),
        h<HTMLButtonElement>('button', { type: 'button', class: 'primary', text: 'Apply', onclick: () => {
          const value = input.value.trim();
          if (/^https?:\/\//.test(value)) applyMark('link', value);
          close();
        } }),
      ),
    ), null);
  }

  // ---------- find and replace ----------
  function openFindDialog(opener: HTMLElement | null): void {
    let matches: number[] = [];
    let current = 0;
    const findInput = h<HTMLInputElement>('input', { type: 'text', 'aria-label': 'Find' }) as HTMLInputElement;
    const replaceInput = h<HTMLInputElement>('input', { type: 'text', 'aria-label': 'Replace with' }) as HTMLInputElement;
    const matchCaseToggle = h<HTMLInputElement>('input', { type: 'checkbox', id: 'find-match-case' }) as HTMLInputElement;
    const countLabel = h('span', { class: 'find-count' });
    let announceTimer = 0;

    const computeMatches = (): void => {
      const query = findInput.value;
      if (renderCtx) {
        renderCtx.matchCase = matchCaseToggle.checked;
        renderCtx.findQuery = query.length > 0 ? query : null;
      }
      state.matchCase = matchCaseToggle.checked;
      state.findQuery = query.length > 0 ? query : null;
      matches = [];
      if (query.length > 0) {
        const text = pageModel.model.text;
        const hay = matchCaseToggle.checked ? text : text.toLowerCase();
        const needle = matchCaseToggle.checked ? query : query.toLowerCase();
        let idx = 0;
        while (idx + needle.length <= hay.length) {
          const found = hay.indexOf(needle, idx);
          if (found === -1) break;
          matches.push(found);
          idx = found + needle.length;
        }
      }
      current = 0;
      page?.render();
      countLabel.textContent = matches.length === 0 ? 'No matches' : matches.length === 1 ? '1 match' : `${matches.length} matches`;
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => {
        announce(matches.length === 0 ? 'No matches' : matches.length === 1 ? '1 match' : `${matches.length} matches`);
      }, 300);
    };

    const step = (dir: 1 | -1): void => {
      if (matches.length === 0) return;
      current = (current + dir + matches.length) % matches.length;
      const at = matches[current]!;
      setCaret(at, findInput.value.length);
      const pos = page?.positionOf(at);
      (pos?.node.parentElement as HTMLElement | undefined)?.scrollIntoView?.({ block: 'center' });
      countLabel.textContent = `Match ${current + 1} of ${matches.length}`;
    };

    const replaceOne = (): void => {
      if (matches.length === 0 || !findInput.value || state.mode === 'viewing') return;
      const at = matches[current] ?? matches[0]!;
      sendReplace(at, findInput.value.length, replaceInput.value);
    };

    const sendReplace = (at: number, length: number, replaceWith: string): void => {
      if (state.mode === 'editing' && canEdit()) {
        sendFrame('editing', [{ delete: length, at }, ...(replaceWith ? [{ insert: replaceWith, at }] : [])]);
      } else if (state.mode === 'suggesting' && canSuggest()) {
        sendFrame('suggesting', [{ delete: length, at }, ...(replaceWith ? [{ insert: replaceWith, at: at + length }] : [])]);
      }
    };

    const replaceAll = async (): Promise<void> => {
      if (!findInput.value || matches.length === 0 || state.mode === 'viewing') return;
      if (state.mode === 'editing' && canEdit()) {
        const count = matches.length;
        for (const at of [...matches].reverse()) {
          sendReplace(at, findInput.value.length, replaceInput.value);
        }
        announce(count === 1 ? 'Replaced 1 match' : `Replaced ${count} matches`);
      } else if (state.mode === 'suggesting' && canSuggest()) {
        try {
          const res = await socket.send({ type: 'replace_all', mode: 'suggesting', find: findInput.value, replace: replaceInput.value, matchCase: matchCaseToggle.checked });
          const count = res.type === 'ack' ? res.count ?? 0 : 0;
          announce(count === 1 ? 'Suggested 1 replacement' : `Suggested ${count} replacements`);
          await reload();
        } catch {
          // refused; nothing changes
        }
      }
      window.setTimeout(computeMatches, 200);
    };

    openDialog((close) => {
      findInput.addEventListener('input', computeMatches);
      findInput.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter') {
          ke.preventDefault();
          step(ke.shiftKey ? -1 : 1);
        }
      });
      window.setTimeout(() => findInput.focus(), 20);
      return h('div', { class: 'dialog find-dialog', role: 'dialog', 'aria-label': 'Find and replace' },
        h('h2', { text: 'Find and replace' }),
        h('div', { class: 'field' }, h('label', { text: 'Find' }), findInput),
        h('div', { class: 'field' }, h('label', { text: 'Replace with' }), replaceInput),
        h('label', { for: 'find-match-case' }, matchCaseToggle, ' Match case'),
        h('div', {}, countLabel),
        h('div', { class: 'row' },
          h<HTMLButtonElement>('button', { type: 'button', text: 'Previous match', onclick: () => step(-1) }),
          h<HTMLButtonElement>('button', { type: 'button', text: 'Next match', onclick: () => step(1) }),
          h<HTMLButtonElement>('button', { type: 'button', text: 'Replace', onclick: replaceOne }),
          h<HTMLButtonElement>('button', { type: 'button', text: 'Replace all', onclick: () => void replaceAll() }),
          h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: () => {
            state.findQuery = null;
            if (renderCtx) renderCtx.findQuery = null;
            page?.render();
            close();
          } }),
        ),
      );
    }, opener);
  }

  // ---------- share dialog ----------
  function openShareDialog(opener: HTMLElement): void {
    openDialog((close) => {
      const list = h('ul', { 'aria-label': 'People with access', style: 'list-style:none;padding:0;margin:0' });
      const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Share proposal' },
        h('h2', { text: 'Share proposal' }),
        list,
        h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close })),
      );
      const renderShares = async (): Promise<void> => {
        const { shares } = await api.shares(documentId);
        list.textContent = '';
        for (const share of shares) {
          const person = share.person as PersonObject;
          const row = h('li', { class: 'share-row' },
            h('span', { class: 'name', text: person.displayName }),
            h('span', { class: 'role-chip', text: roleLabel((share.role as string | undefined) ?? person.role ?? '') }),
          );
          if (state.role === 'owner' && share.shareId !== undefined) {
            if (typeof share.email === 'string') row.append(h('span', { class: 'email', text: share.email }));
            if (share.status === 'expired') row.append(h('span', { class: 'email', text: 'Ended' }));
            else if (typeof share.endsAt === 'string') row.append(h('span', { class: 'email', text: `Until ${fmtDate(share.endsAt)}` }));
            const select = h<HTMLSelectElement>('select', { 'aria-label': `Access for ${person.displayName}` },
              ...(['editor', 'commenter', 'viewer'] as const).map((r) => h('option', { value: r, text: roleLabel(r), ...(((share.role as string) ?? person.role) === r ? { selected: true } : {}) })),
            ) as HTMLSelectElement;
            select.addEventListener('change', async () => {
              try {
                await api.updateShare(documentId, share.shareId as string, { role: select.value });
                announce(`${person.displayName} is now ${roleLabel(select.value)}`);
              } catch {
                // share_ended: the row refreshes to its current state
              }
              await renderShares();
            });
            const remove = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': `Remove ${person.displayName}`, text: 'Remove', onclick: async () => {
              try {
                await api.removeShare(documentId, share.shareId as string);
                announce(`Removed ${person.displayName}`);
              } catch {
                // already removed
              }
              await renderShares();
              const nextRow = list.querySelector<HTMLElement>('input[type="email"]') ?? list.querySelector<HTMLElement>('select');
              nextRow?.focus();
            } });
            row.append(select, remove);
          }
          list.append(row);
        }
        if (state.role === 'owner') {
          const emailInput = h<HTMLInputElement>('input', { type: 'email', 'aria-label': 'Email', placeholder: 'Email' }) as HTMLInputElement;
          const roleSelect = h<HTMLSelectElement>('select', { 'aria-label': 'Access' },
            ...(['editor', 'commenter', 'viewer'] as const).map((r) => h('option', { value: r, text: roleLabel(r) })),
          ) as HTMLSelectElement;
          const endsToggle = h<HTMLInputElement>('input', { type: 'checkbox', id: 'share-ends' }) as HTMLInputElement;
          const endsInput = h<HTMLInputElement>('input', { type: 'datetime-local', 'aria-label': 'Access ends', disabled: true }) as HTMLInputElement;
          endsToggle.addEventListener('change', () => {
            endsInput.disabled = !endsToggle.checked;
          });
          const addBtn = h<HTMLButtonElement>('button', { type: 'button', class: 'primary', text: 'Add person', onclick: async () => {
            addBtn.textContent = 'Adding';
            addBtn.disabled = true;
            try {
              const res = await api.addShare(documentId, emailInput.value.trim(), roleSelect.value, endsToggle.checked && endsInput.value ? new Date(endsInput.value).toISOString() : null);
              const person = (res as { person: PersonObject }).person;
              announce(`Shared with ${person.displayName} as ${roleLabel(roleSelect.value)}`);
              emailInput.value = '';
            } catch (err) {
              const fields = (err as { fields?: Record<string, string> }).fields;
              const code = (err as { code?: string }).code;
              if (code === 'already_shared') announce('This person already has access.');
              else if (fields?.email) announce(fields.email);
              else if (fields?.role) announce(fields.role);
              else if (fields?.endsAt) announce(fields.endsAt);
            } finally {
              addBtn.textContent = 'Add person';
              addBtn.disabled = false;
            }
            await renderShares();
          } });
          list.append(h('li', { class: 'share-row' },
            emailInput, roleSelect,
            h('label', { class: 'small-caps', for: 'share-ends' }, endsToggle, ' Set an end time'),
            endsInput,
            addBtn,
          ));
        } else {
          list.append(h('li', { class: 'email', text: 'Only the proposal owner can change access.' }));
        }
      };
      void renderShares();
      return dialog;
    }, opener);
  }

  // ---------- phone layout ----------
  function applyPhoneLayout(): void {
    const phone = isPhone();
    phoneToolbarButton.style.display = phone ? '' : 'none';
    phoneSheetButton.style.display = phone ? '' : 'none';
  }

  function updatePhoneButton(): void {
    const open = pageModel.cards.filter((c) => c.kind === 'suggestion' || c.ref.status === 'open' || c.ref.status === 'reopened').length;
    phoneSheetButton.textContent = `Cards (${open})`;
  }

  function openPhoneSheet(): void {
    const overlay = h('div', { class: 'bottom-sheet-overlay' });
    const sheet = h('div', { class: 'bottom-sheet', role: 'dialog', 'aria-label': 'Comments and suggestions' });
    const close = (): void => {
      overlay.remove();
      phoneSheetButton.focus();
    };
    sheet.append(h('div', { class: 'grab-handle' }));
    let num = 0;
    for (const card of sortedCards()) {
      num += 1;
      const el = card.kind === 'suggestion' ? suggestionCard(card) : commentCard(card);
      el.prepend(h('span', { class: 'card-author', text: `Card ${num}` }));
      sheet.append(el);
    }
    const closeBtn = h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close });
    sheet.append(h('div', { class: 'row' }, closeBtn));
    overlay.append(sheet);
    overlay.addEventListener('click', (e: Event) => {
      if (e.target === overlay) close();
    });
    document.body.append(overlay);
    trapFocus(sheet, close);
    const firstCard = sheet.querySelector<HTMLElement>('[data-card-id]');
    (firstCard ?? closeBtn).focus();
  }

  function openPhoneMenu(): void {
    const menu = h('div', { class: 'overlay' });
    const close = (): void => {
      menu.remove();
      phoneToolbarButton.focus();
    };
    const items: [string, () => void][] = [
      ['Bold', () => applyMark('bold', !selectionMarks().bold)],
      ['Italic', () => applyMark('italic', !selectionMarks().italic)],
      ['Underline', () => applyMark('underline', !selectionMarks().underline)],
      ['Link', () => openLinkDialog()],
      ['Paragraph style', () => applyStyle('paragraph')],
      ['Comment', () => startComment()],
      ['Find and replace', () => openFindDialog(phoneToolbarButton)],
      ['Accept all', () => confirmAll('accept', phoneToolbarButton)],
      ['Reject all', () => confirmAll('reject', phoneToolbarButton)],
      ['Outline', () => openOutlineDialog()],
      ['Share', () => openShareDialog(phoneToolbarButton)],
    ];
    const list = h('div', { class: 'dialog', role: 'menu', 'aria-label': 'Toolbar' },
      h('h2', { text: 'Toolbar' }),
      ...items.map(([label, action]) => h<HTMLButtonElement>('button', { type: 'button', role: 'menuitem', text: label, onclick: () => {
        close();
        window.setTimeout(action, 10);
      } })),
      h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close })),
    );
    menu.append(list);
    document.body.append(menu);
    trapFocus(list, close);
    list.querySelector<HTMLElement>('button')?.focus();
  }

  function openOutlineDialog(): void {
    openDialog((close) => {
      const listbox = h('ul', { role: 'listbox', 'aria-label': 'Headings', style: 'list-style:none;padding:0;margin:0' });
      const options: HTMLElement[] = [];
      const entries = outlineEntries();
      for (const entry of entries) {
        const opt = h('li', { role: 'option', 'aria-selected': 'false', tabindex: '-1', text: entry.text }) as HTMLElement;
        opt.addEventListener('click', () => {
          jumpToHeading(entry.at);
          close();
        });
        listbox.append(opt);
        options.push(opt);
      }
      wireListbox(listbox, options, (idx) => {
        jumpToHeading(entries[idx]?.at ?? 0);
        close();
      });
      return h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Outline' },
        h('h2', { text: 'Outline' }),
        listbox,
        h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close })),
      );
    }, phoneToolbarButton);
  }

  // ---------- typing ----------
  function wireTyping(container: HTMLElement): void {
    container.setAttribute('role', 'textbox');
    container.setAttribute('aria-multiline', 'true');
    container.setAttribute('aria-label', 'Proposal body');
    container.setAttribute('contenteditable', 'true');
    container.setAttribute('spellcheck', 'false');
    container.tabIndex = 0;

    container.addEventListener('beforeinput', (e: Event) => {
      const ie = e as InputEvent;
      if (state.mode === 'viewing' || state.readOnly || !state.connected) {
        ie.preventDefault();
        return;
      }
      const allowed = state.mode === 'suggesting' ? canSuggest() : canEdit();
      if (!allowed) {
        ie.preventDefault();
        return;
      }
      const { at, length } = caretOffset();
      const mode: Mode = state.mode;
      // the caret intent is set before the frame applies, so the re-render restores it
      switch (ie.inputType) {
        case 'insertText': {
          ie.preventDefault();
          if (length > 0) {
            pendingCaret = { at: at + (ie.data?.length ?? 0), length: 0 };
            sendFrame(mode, [{ delete: length, at }, { insert: ie.data ?? '', at }]);
          } else {
            pendingCaret = { at: at + (ie.data?.length ?? 0), length: 0 };
            sendFrame(mode, [{ insert: ie.data ?? '', at }]);
          }
          break;
        }
        case 'insertParagraph': {
          ie.preventDefault();
          if (length > 0) sendFrame(mode, [{ delete: length, at }]);
          pendingCaret = { at: at + 1, length: 0 };
          sendFrame(mode, [{ insert: '\n', at }]);
          break;
        }
        case 'insertFromPaste': {
          ie.preventDefault();
          const text = (ie as InputEvent & { dataTransfer?: DataTransfer }).dataTransfer?.getData('text/plain')?.replace(/\r\n?/g, '\n') ?? '';
          if (length > 0) sendFrame(mode, [{ delete: length, at }]);
          pendingCaret = { at: at + text.length, length: 0 };
          if (text) sendFrame(mode, [{ insert: text, at }]);
          break;
        }
        case 'deleteContentBackward': {
          ie.preventDefault();
          if (length > 0) {
            pendingCaret = { at, length: 0 };
            sendFrame(mode, [{ delete: length, at }]);
          } else if (at > 0) {
            pendingCaret = { at: at - 1, length: 0 };
            sendFrame(mode, [{ delete: 1, at: at - 1 }]);
          }
          break;
        }
        case 'deleteContentForward': {
          ie.preventDefault();
          if (length > 0) {
            pendingCaret = { at, length: 0 };
            sendFrame(mode, [{ delete: length, at }]);
          } else {
            pendingCaret = { at, length: 0 };
            sendFrame(mode, [{ delete: 1, at }]);
          }
          break;
        }
        case 'deleteByCut': {
          ie.preventDefault();
          if (length > 0) {
            pendingCaret = { at, length: 0 };
            sendFrame(mode, [{ delete: length, at }]);
          }
          break;
        }
        case 'historyUndo':
        case 'historyRedo':
          ie.preventDefault();
          break;
        default:
          break;
      }
    });

    container.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const mod = ke.ctrlKey || ke.metaKey;
      // word-wise selection per the brief: a word is a run of letters or digits
      if (mod && ke.shiftKey && (ke.key === 'ArrowRight' || ke.key === 'ArrowLeft')) {
        const text = pageModel.model.text;
        const sel = window.getSelection();
        if (!sel || !page) return;
        const anchorOff = page.offsetOf(sel.anchorNode!, sel.anchorOffset);
        const focusOff = page.offsetOf(sel.focusNode!, sel.focusOffset);
        let newFocus: number;
        if (ke.key === 'ArrowRight') {
          if (focusOff >= text.length) return;
          const wEnd = wordEnd(text, focusOff);
          newFocus = wEnd > focusOff ? wEnd : wordEnd(text, Math.min(text.length, wEnd + 1));
        } else {
          if (focusOff === 0) return;
          const wStart = wordStart(text, focusOff);
          newFocus = wStart < focusOff ? wStart : Math.max(0, wordStart(text, Math.max(0, wStart - 1)));
        }
        ke.preventDefault();
        const start = Math.min(anchorOff, newFocus);
        const end = Math.max(anchorOff, newFocus);
        setCaret(start, end - start);
        return;
      }
      if (mod && !ke.shiftKey && (ke.key === 'ArrowRight' || ke.key === 'ArrowLeft')) {
        const text = pageModel.model.text;
        const { at } = caretOffset();
        ke.preventDefault();
        let target: number;
        if (ke.key === 'ArrowRight') {
          const wEnd = wordEnd(text, at);
          target = wEnd > at ? wEnd : wordEnd(text, Math.min(text.length, wEnd + 1));
        } else {
          const wStart = wordStart(text, at);
          target = wStart < at ? wStart : Math.max(0, wordStart(text, Math.max(0, wStart - 1)));
        }
        setCaret(target);
        return;
      }
      if (mod && !ke.altKey && !ke.shiftKey) {
        const key = ke.key.toLowerCase();
        if (key === 'b') { ke.preventDefault(); if (canEdit()) applyMark('bold', !selectionMarks().bold); return; }
        if (key === 'i') { ke.preventDefault(); if (canEdit()) applyMark('italic', !selectionMarks().italic); return; }
        if (key === 'u') { ke.preventDefault(); if (canEdit()) applyMark('underline', !selectionMarks().underline); return; }
      }
      if (mod && ke.altKey) {
        const key = ke.key.toLowerCase();
        if (key === 'm') { ke.preventDefault(); startComment(); return; }
        if (key === '0') { ke.preventDefault(); if (canEdit()) applyStyle('paragraph'); return; }
        if (key === '1' || key === '2' || key === '3') {
          ke.preventDefault();
          if (canEdit()) applyStyle(key === '1' ? 'heading1' : key === '2' ? 'heading2' : 'heading3');
          return;
        }
      }
      if (mod && ke.key.toLowerCase() === 'f') {
        ke.preventDefault();
        openFindDialog(container);
        return;
      }
      if (ke.altKey && ke.shiftKey && (ke.key === 'ArrowDown' || ke.key === 'ArrowUp')) {
        ke.preventDefault();
        cycleCards(ke.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (ke.ctrlKey && !ke.metaKey && (ke.key === 'z' || ke.key === 'y')) {
        ke.preventDefault();
      }
    });

    document.addEventListener('selectionchange', () => {
      if (document.activeElement === container || container.contains(document.activeElement) || document.activeElement === document.body) {
        for (const fn of toolbarSyncFns) fn();
        sendCaret();
      }
    });

    container.addEventListener('click', (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-anchor-for], [data-marker-for]');
      if (!target) return;
      const id = target.getAttribute('data-anchor-for') ?? target.getAttribute('data-marker-for');
      const el = document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null;
      if (isPhone()) {
        openPhoneSheet();
        window.setTimeout(() => {
          document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)?.focus();
        }, 60);
      } else {
        el?.focus();
        el?.scrollIntoView({ block: 'center' });
      }
    });
  }

  function cycleCards(dir: 1 | -1): void {
    const els = cardElements.map((c) => c.el).filter((el) => document.contains(el));
    if (els.length === 0) return;
    const focused = document.activeElement?.closest('[data-card-id]') as HTMLElement | null;
    let idx: number;
    if (focused) {
      const current = els.findIndex((el) => el === focused || el.contains(focused));
      idx = (current + dir + els.length) % els.length;
    } else {
      const { at } = caretOffset();
      const spans = els.map((el) => {
        const id = el.getAttribute('data-card-id')!;
        const card = pageModel.cards.find((c) => c.id === id);
        return card ? (card.kind === 'suggestion' ? (card.sug.inserted ?? card.sug.deleted)?.at ?? Infinity : (card.ref.anchor?.at ?? Infinity)) : Infinity;
      });
      if (dir === 1) {
        const next = spans.findIndex((s) => s >= at);
        idx = next === -1 ? 0 : next;
      } else {
        let last = els.length - 1;
        for (let i = els.length - 1; i >= 0; i -= 1) {
          if (spans[i]! < at) {
            last = i;
            break;
          }
        }
        idx = last;
      }
    }
    els[idx]?.focus();
    els[idx]?.scrollIntoView({ block: 'center' });
  }

  // ---------- socket frames ----------
  function wireSocket(): void {
    socket.onFrame = (f: ServerFrame) => {
      switch (f.type) {
        case 'op': {
          const ops = f.ops as { insert?: string; delete?: number; at: number; mark?: string; value?: unknown; length?: number; style?: string }[];
          pendingCaret = caretOffset();
          for (const op of ops) {
            if (op.insert !== undefined) pageModel.applyTextOps([{ ins: op.insert, at: op.at }]);
            else if (op.delete !== undefined) pageModel.applyTextOps([{ del: op.delete, at: op.at }]);
            else if (op.mark !== undefined) pageModel.applyTextOps([{ mark: op.mark as MarkType, value: op.value as boolean | string | null, at: op.at, length: op.length ?? 0 }]);
            else if (op.style !== undefined) pageModel.applyTextOps([{ style: op.style as BlockStyle, at: op.at }]);
          }
          state.revision = Math.max(state.revision, f.revision);
          page?.render();
          renderCards();
          updateWordCount();
          restoreCaret();
          break;
        }
        case 'card_added': {
          const card = f.card as unknown as SnapshotSuggestion & SnapshotComment;
          if (card.kind === 'insert' || card.kind === 'delete' || card.kind === 'replace') {
            // the server's record replaces every local temporary record for the same edit
            pageModel.model.suggestions = pageModel.model.suggestions.filter((s) => s.id !== card.id && !(tempSuggestionIds.has(s.id) && s.authorId === card.author.personId));
            for (const tid of tempSuggestionIds) tempSuggestionIds.delete(tid);
            pageModel.cards = pageModel.cards.filter((c) => !(c.kind === 'suggestion' && tempSuggestionIds.has(c.id)));
            pageModel.model.suggestions.push({
              id: card.id, kind: card.kind, authorId: card.author.personId,
              authorRole: (card.author.role ?? 'editor') as Role,
              inserted: card.inserted, deleted: card.deleted, contentDeleted: card.contentDeleted,
              status: card.status as 'open' | 'accepted' | 'rejected', createdAt: card.createdAt,
              closedAt: null, closedById: null, closedAs: null, decidedById: null,
            });
            if (!state.people.some((p) => p.personId === card.author.personId)) state.people.push(card.author);
          } else {
            pageModel.model.comments = pageModel.model.comments.filter((c) => c.id !== card.id);
            pageModel.model.comments.push({
              id: card.id, authorId: card.author.personId, body: card.body,
              mentions: card.mentions.map((m) => m.personId), anchor: card.anchor,
              contentDeleted: card.contentDeleted, status: card.status as 'open' | 'resolved' | 'reopened',
              replies: card.replies.map((r) => ({ id: r.id, authorId: r.author.personId, body: r.body, createdAt: r.createdAt })),
              createdAt: card.createdAt,
            });
          }
          rebuildCards();
          renderCards();
          page?.render();
          break;
        }
        case 'card_changed': {
          const card = f.card as unknown as SnapshotSuggestion & SnapshotComment;
          if (card.kind === 'insert' || card.kind === 'delete' || card.kind === 'replace') {
            const sug = pageModel.model.suggestions.find((x) => x.id === card.id);
            if (sug) {
              sug.kind = card.kind;
              sug.inserted = card.inserted;
              sug.deleted = card.deleted;
              sug.contentDeleted = card.contentDeleted;
              sug.status = card.status as 'open' | 'accepted' | 'rejected';
            }
          } else {
            const existing = pageModel.model.comments.find((c) => c.id === card.id);
            if (existing) {
              existing.body = card.body;
              existing.status = card.status as 'open' | 'resolved' | 'reopened';
              existing.replies = card.replies.map((r) => ({ id: r.id, authorId: r.author.personId, body: r.body, createdAt: r.createdAt }));
              existing.anchor = card.anchor;
              existing.contentDeleted = card.contentDeleted;
            }
          }
          rebuildCards();
          renderCards();
          page?.render();
          break;
        }
        case 'card_closed': {
          pageModel.model.suggestions = pageModel.model.suggestions.filter((s) => s.id !== f.cardId);
          rebuildCards();
          renderCards();
          page?.render();
          break;
        }
        case 'caret': {
          pageModel.carets.set(f.person.personId, { person: f.person, at: f.at, length: f.length, idle: false });
          page?.render();
          break;
        }
        case 'presence': {
          if (f.state === 'left') pageModel.carets.delete(f.person.personId);
          else {
            const cur = pageModel.carets.get(f.person.personId);
            pageModel.carets.set(f.person.personId, { person: f.person, at: cur?.at ?? 0, length: cur?.length ?? 0, idle: f.state === 'idle' });
            if (!state.people.some((p) => p.personId === f.person.personId)) {
              state.people.push(f.person);
              renderPeople();
              rebuildCards();
            }
          }
          page?.render();
          break;
        }
        case 'saved': {
          if (f.revision >= state.revision) setSaveState('saved');
          break;
        }
        case 'save_failed': {
          setSaveState('failed');
          break;
        }
        case 'role_changed': {
          state.role = f.role as Role;
          state.mode = f.mode;
          announce(`Your access changed to ${roleLabel(f.role)}.${f.mode === 'suggesting' ? " You're now suggesting." : f.mode === 'viewing' ? " You're now viewing." : ''}`);
          renderChrome();
          break;
        }
        case 'title_changed': {
          state.title = f.title;
          state.client = f.client;
          renderTitle();
          break;
        }
        case 'access_ended': {
          showAccessEnded(f.reason);
          socket.close();
          break;
        }
        default:
          break;
      }
      if (f.type === 'notice' || f.type === 'lists_changed') refreshNoticesBadge?.();
    };
    socket.onDisconnect = () => {
      state.connected = false;
      state.readOnly = true;
      connectionBanner.style.display = '';
    };
    socket.onReconnect = () => {
      state.connected = true;
      state.readOnly = false;
      connectionBanner.style.display = 'none';
      void socket.send({ type: 'join', documentId, revision: state.revision }).then(() => reload()).catch(() => undefined);
    };
  }

  /** The Notices dialog: each item is a link that opens its proposal. */
  function openNoticesDialog(opener: HTMLElement): void {
    openDialog(async (close) => {
      const data = await api.notices();
      const list = h('ul', { class: 'notices-list', 'aria-label': 'Notices' });
      for (const notice of data.notices) {
        const link = h('a', { href: `/d/${notice.documentId}`, text: notice.text, onclick: (e: Event) => {
          e.preventDefault();
          void api.readNotice(notice.id).catch(() => undefined);
          close();
          void notice.commentId;
          if (notice.documentId === documentId) {
            void reload().then(() => {
              const el = document.querySelector(`[data-card-id="${notice.commentId}"]`) as HTMLElement | null;
              el?.focus();
            });
          } else {
            window.location.href = `/d/${notice.documentId}`;
          }
        } });
        list.append(h('li', {}, notice.read ? null : h('span', { class: 'unread-dot' }), link));
      }
      if (data.notices.length === 0) list.append(h('li', { text: 'No notices yet.' }));
      void refreshNoticesBadge;
      return h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Notices' },
        h('h2', { text: 'Notices' }),
        list,
        h('div', { class: 'row' }, h<HTMLButtonElement>('button', { type: 'button', text: 'Close', onclick: close })),
      );
    }, opener);
  }

  // ---------- mount ----------
  async function mount(): Promise<void> {
    let snap: Snapshot;
    try {
      snap = await api.snapshot(documentId);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'storage_unavailable') {
        showStorageUnavailable();
        return;
      }
      showNotFound();
      return;
    }
    state.role = snap.myAccess.role as Role;
    state.mode = snap.myAccess.mode;
    state.title = snap.title;
    state.client = snap.client;
    state.accessEndsAt = snap.myAccess.accessEndsAt;
    state.revision = snap.revision;
    state.people = snap.people;
    pageModel.model.text = snap.text;
    pageModel.model.lineStyles = snap.blocks.map((b) => b.style as BlockStyle);
    pageModel.model.marks = snap.marks.map((m) => ({ type: m.type as MarkType, at: m.at, length: m.length, ...(m.href ? { href: m.href } : {}) }));
    pageModel.model.revision = snap.revision;
    cardsFromSnapshot(snap.suggestions, snap.comments);

    // ---- chrome: menu bar, toolbar, status bar ----
    const noticesBadge = h('span', {});
    const noticesButton = h<HTMLButtonElement>('button', { type: 'button', 'aria-label': 'Notices', text: 'Notices' }, noticesBadge);
    const refreshBadge = async (): Promise<void> => {
      try {
        const { unread } = await api.notices();
        noticesBadge.textContent = '';
        if (unread > 0) noticesBadge.append(h('span', { class: 'badge', text: String(unread) }));
      } catch {
        // keep the last count
      }
    };
    void refreshBadge();
    const menuBar = h('nav', { class: 'menu-bar' },
      h('a', { href: '/', text: 'Documents' }),
      titleBox,
      peopleList,
      h('span', { style: 'flex:1' }),
      shareButton,
      noticesButton,
      phoneToolbarButton,
      modeGroup,
    );
    noticesButton.addEventListener('click', () => openNoticesDialog(noticesButton));
    const documentsLink = menuBar.querySelector('a')!;
    void documentsLink;
    shareButton.addEventListener('click', () => openShareDialog(shareButton));
    phoneToolbarButton.addEventListener('click', () => openPhoneMenu());

    const statusRegion = h('div', { role: 'region', 'aria-label': 'Document status', class: 'status-bar' },
      saveStatusEl,
      wordCountEl,
      accessLabel,
      h('span', { style: 'flex:1' }),
      phoneSheetButton,
    );
    phoneSheetButton.addEventListener('click', () => openPhoneSheet());

    const workArea = h('div', { class: 'editor-wrap' }, outlinePanel, h('div', {}), marginEl);

    root.append(connectionBanner, storageBanner, menuBar, toolbarEl, statusRegion, workArea);

    renderCtx = {
      pageEl: workArea.children[1] as HTMLElement,
      model: pageModel,
      myPersonId: me.personId,
      isPhone,
      findQuery: null,
      matchCase: false,
      focusedCardId: null,
      onCardFocus: () => undefined,
      markerNumbers,
    };
    page = createPage(renderCtx);
    (workArea.children[1] as HTMLElement).append(page.container, tetherSvg);
    wireTyping(page.container);

    setSaveState(snap.saveState);
    state.loadedOnce = true;
    page.render();
    renderChrome();
    updateWordCount();

    wireSocket();
    if (!socket.connected) {
      socket.connect();
      startHeartbeat();
    }
    void socket.send({ type: 'join', documentId, revision: state.revision }).then((joined) => {
      if (joined.type === 'joined') {
        for (const entry of joined.people ?? []) {
          pageModel.carets.set(entry.person.personId, { person: entry.person, at: 0, length: 0, idle: entry.state === 'idle' });
        }
        renderPeople();
        page?.render();
      }
    }).catch((err: Error) => {
      if (err.message === 'not_found') showNotFound();
      else if (err.message === 'conflict') {
        // already joined on this socket; carry on
      } else {
        void reload();
      }
    });
  }

  void mount();
}
