import type { Entry, NightStatus, Technique } from '../api.js';
import { COPY, loggedTime } from '../copy.js';
import { h, setHidden, setText } from '../dom.js';
import type { KeptEntry } from './keep.js';

export interface NewEntryFields {
  readonly title: string;
  readonly text: string;
  readonly dreamsRecalled: number;
  readonly lucid: boolean;
  readonly wbtb: boolean;
  readonly technique: Technique;
  readonly techniqueMinutes: number;
}

export interface JournalHandlers {
  readonly save: () => void;
  readonly tag: (entryId: string, button: HTMLButtonElement) => void;
  readonly share: (entryId: string, next: boolean, button: HTMLButtonElement) => void;
  readonly edit: (keptId: string) => void;
  readonly discard: (keptId: string) => void;
  readonly recordMemo: (button: HTMLButtonElement) => void;
  readonly memoError: () => void;
}

function labelled(
  labelText: string,
  control: HTMLElement,
  id: string,
): HTMLElement {
  control.id = id;
  return h('div', { class: 'field' }, [h('label', { for: id, text: labelText }), control]);
}

function reconcile(parent: HTMLElement, nodes: readonly HTMLElement[]): void {
  for (const existing of [...parent.children]) {
    if (!nodes.includes(existing as HTMLElement)) parent.removeChild(existing);
  }
  nodes.forEach((node, index) => {
    const current = parent.children[index];
    if (current !== node) parent.insertBefore(node, current ?? null);
  });
}

export function textOffsetsOfSelection(host: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let start: number | null = null;
  let end: number | null = null;
  let node = walker.nextNode();
  while (node !== null) {
    const length = node.textContent?.length ?? 0;
    if (node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) end = offset + range.endOffset;
    offset += length;
    node = walker.nextNode();
  }
  if (start === null || end === null || end <= start) return null;
  return { start, end };
}

export class Journal {
  readonly region: HTMLElement;
  readonly form: HTMLFormElement;
  readonly title: HTMLInputElement;
  readonly text: HTMLTextAreaElement;
  readonly recalled: HTMLInputElement;
  readonly lucid: HTMLInputElement;
  readonly wbtb: HTMLInputElement;
  readonly techniqueMinutes: HTMLInputElement;
  readonly memoButton: HTMLButtonElement;
  readonly saveButton: HTMLButtonElement;
  private readonly techniqueBlock: HTMLElement;
  private readonly lockedNote: HTMLElement;
  private readonly techniqueRadios: HTMLInputElement[] = [];
  private readonly sections: HTMLElement;
  private readonly sectionNodes = new Map<string, HTMLElement>();
  private readonly articleNodes = new Map<string, HTMLElement>();
  private readonly renderedEntries = new Map<string, Entry>();
  private readonly handlers: JournalHandlers;

  constructor(handlers: JournalHandlers) {
    this.handlers = handlers;
    this.title = h('input', { type: 'text', autocomplete: 'off' });
    this.text = h('textarea', { rows: '4' });
    this.recalled = h('input', { type: 'number', min: '0', max: '20', value: '0' });
    this.lucid = h('input', { type: 'checkbox' });
    this.wbtb = h('input', { type: 'checkbox' });
    this.techniqueMinutes = h('input', { type: 'number', min: '0', max: '180', value: '0' });
    this.memoButton = h('button', { type: 'button', class: 'ghost', text: 'Record voice memo' });
    this.saveButton = h('button', { type: 'submit', class: 'primary', text: 'Save entry' });

    const radios = h('div', { role: 'radiogroup', 'aria-label': 'Technique', class: 'radios' });
    for (const [value, label] of [
      ['none', 'None'],
      ['mild', 'MILD'],
      ['ssild', 'SSILD'],
    ] as const) {
      const radio = h('input', {
        type: 'radio',
        name: 'technique',
        value,
        id: `technique-${value}`,
        checked: value === 'none',
      });
      this.techniqueRadios.push(radio);
      radios.append(
        h('span', { class: 'radio' }, [radio, h('label', { for: `technique-${value}`, text: label })]),
      );
    }

    this.techniqueBlock = h('div', { class: 'night8' }, [
      labelled('Woke for WBTB', this.wbtb, 'new-wbtb'),
      radios,
      labelled('Technique minutes', this.techniqueMinutes, 'new-technique-minutes'),
    ]);
    this.lockedNote = h('p', { class: 'muted', text: COPY.techniqueLocked });

    this.form = h('form', { 'aria-label': 'New entry', class: 'new-entry stack' }, [
      labelled('Dream title', this.title, 'new-title'),
      labelled('Dream text', this.text, 'new-text'),
      labelled('Dreams recalled', this.recalled, 'new-recalled'),
      labelled('Lucid', this.lucid, 'new-lucid'),
      this.techniqueBlock,
      this.lockedNote,
      h('div', { class: 'row' }, [this.memoButton, this.saveButton]),
    ]);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      handlers.save();
    });
    this.memoButton.addEventListener('click', () => {
      handlers.recordMemo(this.memoButton);
    });

    this.sections = h('div', { class: 'nights' });
    this.region = h('section', { role: 'region', 'aria-label': 'Journal', class: 'journal' }, [
      this.form,
      this.sections,
    ]);
    this.setTechniqueUnlocked(false);
  }

  setTechniqueUnlocked(unlocked: boolean): void {
    setHidden(this.techniqueBlock, !unlocked);
    setHidden(this.lockedNote, unlocked);
  }

  fields(): NewEntryFields {
    const chosen = this.techniqueRadios.find((radio) => radio.checked);
    const technique = chosen?.value;
    return {
      title: this.title.value,
      text: this.text.value,
      dreamsRecalled: Number(this.recalled.value === '' ? '0' : this.recalled.value),
      lucid: this.lucid.checked,
      wbtb: this.wbtb.checked,
      technique:
        technique === 'mild' || technique === 'ssild' ? technique : 'none',
      techniqueMinutes: Number(
        this.techniqueMinutes.value === '' ? '0' : this.techniqueMinutes.value,
      ),
    };
  }

  resetForm(): void {
    this.title.value = '';
    this.text.value = '';
    this.recalled.value = '0';
    this.lucid.checked = false;
    this.wbtb.checked = false;
    this.techniqueMinutes.value = '0';
    const none = this.techniqueRadios[0];
    if (none !== undefined) none.checked = true;
  }

  fillFrom(kept: KeptEntry): void {
    this.title.value = kept.title;
    this.text.value = kept.text;
    this.recalled.value = String(kept.dreamsRecalled);
    this.lucid.checked = kept.lucid;
    this.wbtb.checked = kept.wbtb;
    this.techniqueMinutes.value = String(kept.techniqueMinutes);
    for (const radio of this.techniqueRadios) radio.checked = radio.value === kept.technique;
    this.title.focus();
  }

  focusTitle(): void {
    this.title.focus();
  }

  private savedArticle(entry: Entry, homeTz: string): HTMLElement {
    const existing = this.articleNodes.get(entry.id);
    const article =
      existing !== undefined && existing.dataset['kind'] === 'saved'
        ? existing
        : h('article', { class: 'entry', 'data-kind': 'saved' });
    const name = entry.title === '' ? COPY.untitled : entry.title;
    article.setAttribute('aria-label', name);

    let heading = article.querySelector<HTMLElement>('.entry-title');
    if (heading === null) {
      heading = h('h3', { class: 'entry-title' });
      article.append(heading);
    }
    setText(heading, name);

    let state = article.querySelector<HTMLElement>('.state');
    if (state === null) {
      state = h('p', { class: 'state' });
      article.append(state);
    }
    setText(state, COPY.saved);

    let logged = article.querySelector<HTMLElement>('.logged');
    if (logged === null) {
      logged = h('p', { class: 'logged muted' });
      article.append(logged);
    }
    setText(logged, `Logged ${loggedTime(entry.created_at, homeTz)}`);

    let badge = article.querySelector<HTMLElement>('.late');
    if (entry.late_recall) {
      if (badge === null) {
        badge = h('p', { class: 'late badge', text: COPY.lateRecall });
        article.append(badge);
      }
    } else badge?.remove();

    let body = article.querySelector<HTMLElement>('.entry-text');
    if (body === null) {
      body = h('div', {
        class: 'entry-text',
        role: 'textbox',
        'aria-label': 'Entry text',
        'aria-readonly': 'true',
        contenteditable: 'true',
        spellcheck: 'false',
        tabindex: '0',
      });
      body.addEventListener('beforeinput', (event) => {
        event.preventDefault();
      });
      body.addEventListener('paste', (event) => {
        event.preventDefault();
      });
      article.append(body);
    }
    this.renderEntryText(body, entry);

    let memo = article.querySelector<HTMLAudioElement>('audio');
    if (entry.memo !== null) {
      if (memo === null) {
        memo = h('audio', {
          controls: true,
          'aria-label': 'Voice memo',
          preload: 'metadata',
          src: `/api/me/entries/${entry.id}/memo`,
        });
        memo.addEventListener('error', () => {
          this.handlers.memoError();
        });
        article.append(memo);
      }
    } else memo?.remove();

    let actions = article.querySelector<HTMLElement>('.entry-actions');
    if (actions === null) {
      actions = h('div', { class: 'entry-actions row' });
      const tag = h('button', {
        type: 'button',
        class: 'ghost tag',
        text: 'Tag as dream sign',
      });
      tag.addEventListener('click', () => {
        this.handlers.tag(entry.id, tag);
      });
      const share = h('button', { type: 'button', class: 'ghost share' });
      share.addEventListener('click', () => {
        this.handlers.share(entry.id, share.getAttribute('aria-pressed') !== 'true', share);
      });
      actions.append(tag, share);
      article.append(actions);
      article.addEventListener('keydown', (event) => {
        if (event.key !== 't' && event.key !== 'T') return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        this.handlers.tag(entry.id, tag);
      });
    }
    const share = actions.querySelector<HTMLButtonElement>('.share');
    if (share !== null) {
      share.setAttribute('aria-pressed', entry.shared ? 'true' : 'false');
      share.setAttribute('aria-label', 'Share with coach');
      setText(share, entry.shared ? 'Shared with coach' : 'Share with coach');
    }

    this.articleNodes.set(entry.id, article);
    return article;
  }

  private renderEntryText(body: HTMLElement, entry: Entry): void {
    this.renderedEntries.set(entry.id, entry);
    const signature = entry.signs
      .map((sign) => `${sign.start}-${sign.end}-${sign.category}`)
      .join('|');
    if (body.dataset['text'] === entry.text && body.dataset['signs'] === signature) return;
    body.dataset['text'] = entry.text;
    body.dataset['signs'] = signature;
    this.paintText(body, entry.text, entry.signs);
  }

  private paintText(
    body: HTMLElement,
    text: string,
    ranges: readonly { start: number; end: number; category: string }[],
  ): void {
    const pieces: Node[] = [];
    let cursor = 0;
    for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
      if (range.start > cursor) pieces.push(document.createTextNode(text.slice(cursor, range.start)));
      pieces.push(
        h('mark', { class: `sign ${range.category}`, text: text.slice(range.start, range.end) }),
      );
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < text.length) pieces.push(document.createTextNode(text.slice(cursor)));
    body.replaceChildren(...pieces);
  }

  markRange(entryId: string, start: number, end: number): void {
    const body = this.entryTextNode(entryId);
    const entry = this.renderedEntries.get(entryId);
    if (body === null || entry === undefined) return;
    body.dataset['signs'] = `${body.dataset['signs'] ?? ''}|pending`;
    this.paintText(body, entry.text, [...entry.signs, { start, end, category: 'pending' }]);
  }

  clearPending(entryId: string): void {
    const body = this.entryTextNode(entryId);
    const entry = this.renderedEntries.get(entryId);
    if (body === null || entry === undefined) return;
    body.dataset['signs'] = entry.signs
      .map((sign) => `${sign.start}-${sign.end}-${sign.category}`)
      .join('|');
    this.paintText(body, entry.text, entry.signs);
  }

  entryTextNode(entryId: string): HTMLElement | null {
    return this.articleNodes.get(entryId)?.querySelector<HTMLElement>('.entry-text') ?? null;
  }

  private keptArticle(kept: KeptEntry): HTMLElement {
    const existing = this.articleNodes.get(kept.id);
    const article =
      existing !== undefined && existing.dataset['kind'] === 'kept'
        ? existing
        : h('article', { class: 'entry kept', 'data-kind': 'kept' });
    const name = kept.title === '' ? COPY.untitled : kept.title;
    article.setAttribute('aria-label', name);

    let heading = article.querySelector<HTMLElement>('.entry-title');
    if (heading === null) {
      heading = h('h3', { class: 'entry-title' });
      article.append(heading);
    }
    setText(heading, name);

    let state = article.querySelector<HTMLElement>('.state');
    if (state === null) {
      state = h('p', { class: 'state' });
      article.append(state);
    }
    setText(state, COPY.keptOnDevice);

    let bodyText = article.querySelector<HTMLElement>('.kept-text');
    if (bodyText === null) {
      bodyText = h('p', { class: 'kept-text' });
      article.append(bodyText);
    }
    setText(bodyText, kept.text);

    let reason = article.querySelector<HTMLElement>('.reason');
    let actions = article.querySelector<HTMLElement>('.kept-actions');
    if (kept.rejectedReason !== null) {
      if (reason === null) {
        reason = h('p', { class: 'reason' });
        article.append(reason);
      }
      setText(reason, `Not saved: ${kept.rejectedReason}`);
      if (actions === null) {
        const edit = h('button', { type: 'button', class: 'ghost', text: 'Edit as new entry' });
        edit.addEventListener('click', () => {
          this.handlers.edit(kept.id);
        });
        const discard = h('button', { type: 'button', class: 'ghost', text: 'Discard' });
        discard.addEventListener('click', () => {
          this.handlers.discard(kept.id);
        });
        actions = h('div', { class: 'kept-actions row' }, [edit, discard]);
        article.append(actions);
      }
    } else {
      reason?.remove();
      actions?.remove();
    }

    this.articleNodes.set(kept.id, article);
    return article;
  }

  render(
    saved: readonly Entry[],
    kept: readonly KeptEntry[],
    night: NightStatus | null,
    homeTz: string,
  ): void {
    const byNight = new Map<string, { number: number; nodes: HTMLElement[] }>();
    const sectionFor = (nightKey: string, nightNumber: number): HTMLElement[] => {
      const found = byNight.get(nightKey);
      if (found !== undefined) return found.nodes;
      const made = { number: nightNumber, nodes: [] as HTMLElement[] };
      byNight.set(nightKey, made);
      return made.nodes;
    };

    if (night !== null && night.night_number >= 1) {
      sectionFor(night.night_key, night.night_number);
    }
    for (const entry of kept) {
      sectionFor(entry.nightKey, night?.night_number ?? 0).push(this.keptArticle(entry));
    }
    for (const entry of saved) {
      sectionFor(entry.night_key, entry.night_number).push(this.savedArticle(entry, homeTz));
    }

    const keys = [...byNight.keys()].sort((left, right) => (left < right ? 1 : -1));
    const sectionElements: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      const group = byNight.get(key);
      if (group === undefined) continue;
      seen.add(key);
      let section = this.sectionNodes.get(key);
      if (section === undefined) {
        section = h('section', { class: 'night-section' }, [
          h('h2', { class: 'night-heading' }),
          h('div', { class: 'night-entries' }),
        ]);
        this.sectionNodes.set(key, section);
      }
      const heading = section.querySelector<HTMLElement>('.night-heading');
      if (heading !== null) setText(heading, `Night ${group.number}, ${key}`);
      const holder = section.querySelector<HTMLElement>('.night-entries');
      if (holder !== null) {
        reconcile(holder, group.nodes);
        if (group.nodes.length === 0) {
          if (section.querySelector('.empty-night') === null) {
            section.append(h('p', { class: 'empty-night', text: COPY.emptyNight }));
          }
        } else {
          section.querySelector('.empty-night')?.remove();
        }
      }
      section.classList.toggle('current', night !== null && key === night.night_key);
      sectionElements.push(section);
    }
    for (const [key, node] of this.sectionNodes) {
      if (!seen.has(key)) {
        node.remove();
        this.sectionNodes.delete(key);
      }
    }
    reconcile(this.sections, sectionElements);
  }
}
