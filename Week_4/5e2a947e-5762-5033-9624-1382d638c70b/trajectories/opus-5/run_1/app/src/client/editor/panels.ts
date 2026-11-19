import { copy } from '../../shared/copy.js';
import { topicAria } from '../../shared/labels.js';
import { noteError, renderNote } from '../../shared/notes.js';
import { ICON_NAMES, type Operation } from '../../shared/types.js';
import { colourHex } from '../../shared/style.js';
import { lockInfo, permittedChildren, visibleTopics } from '../../shared/tree.js';
import { api, RequestFailed } from '../api.js';
import { clear, el, on } from '../dom.js';
import { announce, notify } from '../shell.js';
import type { Actions } from './actions.js';
import { nextId, type Editor } from './state.js';
import type { CanvasView } from './view.js';

export class OutlinePanel {
  readonly tree: HTMLElement;
  private readonly editor: Editor;
  private readonly actions: Actions;
  private readonly view: CanvasView;
  private rows = new Map<string, HTMLElement>();
  private focusId: string | null = null;

  constructor(editor: Editor, actions: Actions, view: CanvasView) {
    this.editor = editor;
    this.actions = actions;
    this.view = view;
    this.tree = el('div', { class: 'outline-tree', role: 'tree', 'aria-label': 'Outline' });
    on(this.tree, 'keydown', (event) => this.onKey(event as KeyboardEvent));
    on(this.tree, 'focusin', (event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      const id = node.closest<HTMLElement>('[data-outline-id]')?.dataset.outlineId;
      if (id !== undefined && id !== this.focusId) {
        this.focusId = id;
        this.update();
      }
    });
  }

  update(): void {
    const order = visibleTopics(this.editor.view());
    const wanted = new Set(order);
    for (const [id, row] of [...this.rows]) {
      if (!wanted.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
    if (this.focusId === null || !wanted.has(this.focusId)) this.focusId = order[0] ?? null;
    const derived = this.editor.derived();
    const view = this.editor.view();
    for (const id of order) {
      let row = this.rows.get(id);
      if (!row) {
        row = el('div', { class: 'outline-row', role: 'treeitem' });
        row.dataset.outlineId = id;
        on(row, 'click', () => {
          this.focusId = id;
          this.view.focusTopic(id);
          this.update();
        });
        this.rows.set(id, row);
      }
      const info = derived.get(id);
      const topic = this.editor.doc.topics[id];
      if (!info || !topic) continue;
      const aria = topicAria(view, id, info, this.editor.countsFor(id));
      row.setAttribute('aria-level', String(aria.level));
      row.setAttribute('aria-posinset', String(aria.posinset));
      row.setAttribute('aria-setsize', String(aria.setsize));
      row.setAttribute('aria-label', aria.label);
      if (aria.expanded === null) row.removeAttribute('aria-expanded');
      else row.setAttribute('aria-expanded', aria.expanded ? 'true' : 'false');
      row.tabIndex = this.focusId === id ? 0 : -1;
      row.style.paddingLeft = `${(aria.level - 1) * 16 + 8}px`;
      if (!row.contains(document.activeElement) || row === document.activeElement) {
        clear(row);
        row.append(
          el('span', { class: 'outline-bullet', 'aria-hidden': 'true' }),
          el('span', { class: 'outline-title', text: topic.title }),
        );
        const bullet = row.firstElementChild as HTMLElement;
        bullet.style.background = colourHex(info.colour);
      }
    }
    let cursor = this.tree.firstElementChild;
    for (const id of order) {
      const row = this.rows.get(id);
      if (!row) continue;
      if (row === cursor) {
        cursor = row.nextElementSibling;
        continue;
      }
      this.tree.insertBefore(row, cursor);
    }
  }

  private onKey(event: KeyboardEvent): void {
    const id = this.focusId;
    if (id === null) return;
    const order = visibleTopics(this.editor.view());
    const index = order.indexOf(id);
    const topic = this.editor.doc.topics[id];
    if (!topic) return;
    const focusRow = (next: string | null | undefined): void => {
      if (!next) return;
      this.focusId = next;
      this.update();
      this.rows.get(next)?.focus();
    };
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) this.actions.outdent([id]);
        else this.actions.demote([id]);
        this.update();
        this.rows.get(id)?.focus();
        return;
      case 'Enter':
        event.preventDefault();
        this.actions.addSibling(id);
        return;
      case 'F2':
        event.preventDefault();
        this.renameRow(id);
        return;
      case 'ArrowDown':
        event.preventDefault();
        focusRow(order[index + 1]);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(order[index - 1]);
        return;
      case 'ArrowRight':
        event.preventDefault();
        focusRow(permittedChildren(this.editor.view(), id)[0]);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        focusRow(topic.parent_id);
        return;
      case ' ':
        event.preventDefault();
        this.actions.toggleCollapse(id);
        return;
      default:
        break;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      this.renameRow(id, event.key);
    }
  }

  private renameRow(id: string, typed?: string): void {
    const row = this.rows.get(id);
    const topic = this.editor.doc.topics[id];
    if (!row || !topic) return;
    const input = el('input', { type: 'text', class: 'outline-input', 'aria-label': 'Title' });
    input.value = typed ?? topic.title;
    clear(row);
    row.append(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    let settled = false;
    const commit = (save: boolean): void => {
      if (settled) return;
      settled = true;
      const value = input.value.trim();
      if (save && value !== '' && value !== topic.title) {
        this.editor.send([
          {
            op_id: nextId('o'),
            kind: 'title',
            topic_id: id,
            offset: 0,
            delete: [...topic.title].length,
            insert: value,
          },
        ]);
      }
      this.update();
      this.rows.get(id)?.focus();
    };
    on(input, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      event.stopPropagation();
      if (key === 'Enter') {
        event.preventDefault();
        commit(true);
      } else if (key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
    on(input, 'blur', () => commit(true));
  }
}

export class DetailsPanel {
  readonly node: HTMLElement;
  readonly tabs: HTMLElement;
  private readonly editor: Editor;
  private readonly body: HTMLElement;
  private current: 'Notes' | 'Task' | 'Comments' = 'Notes';
  topicId: string | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
    this.body = el('div', { class: 'details-body' });
    this.tabs = el('div', { class: 'tablist', role: 'tablist' });
    this.node = el('div', { class: 'details' }, [this.tabs, this.body]);
    for (const name of ['Notes', 'Task', 'Comments'] as const) {
      const tab = el('button', { type: 'button', role: 'tab', text: name });
      on(tab, 'click', () => {
        this.current = name;
        this.update();
      });
      this.tabs.append(tab);
    }
  }

  open(id: string, tab: 'Notes' | 'Task' | 'Comments' = 'Notes'): void {
    this.topicId = id;
    this.current = tab;
    this.update();
  }

  update(): void {
    for (const tab of this.tabs.children) {
      tab.setAttribute('aria-selected', tab.textContent === this.current ? 'true' : 'false');
      (tab as HTMLElement).tabIndex = tab.textContent === this.current ? 0 : -1;
    }
    clear(this.body);
    const id = this.topicId;
    if (id === null || !this.editor.doc.topics[id]) return;
    if (this.current === 'Notes') this.paintNotes(id);
    else if (this.current === 'Task') this.paintTask(id);
    else this.paintComments(id);
  }

  private paintNotes(id: string): void {
    const topic = this.editor.doc.topics[id];
    const area = el('textarea', { 'aria-label': 'Note', rows: 6 });
    area.value = topic.note;
    const preview = el('div', { class: 'note-preview', role: 'region', 'aria-label': 'Note preview' });
    preview.innerHTML = renderNote(topic.note);
    const error = el('p', { class: 'field-error' });
    on(area, 'change', () => {
      const bad = noteError(area.value);
      if (bad !== null) {
        error.textContent = bad;
        notify(bad, 'warning');
        return;
      }
      error.textContent = '';
      this.editor.send([{ op_id: nextId('o'), kind: 'note', topic_id: id, text: area.value }]);
      preview.innerHTML = renderNote(area.value);
    });
    const attach = el('button', { type: 'button', class: 'secondary', text: 'Attach image' });
    const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': 'Attach image' });
    picker.classList.add('sr-only');
    on(attach, 'click', () => picker.click());
    on(picker, 'change', () => {
      const file = picker.files?.[0];
      if (!file) return;
      notify(copy.uploadingFile(file.name));
      void file
        .arrayBuffer()
        .then((bytes) =>
          api.upload(`/api/maps/${this.editor.mapId}/topics/${id}/attachments`, bytes),
        )
        .then(() => {
          notify(copy.imageAttached);
          return this.editor.resync();
        })
        .catch((error_: unknown) => {
          if (error_ instanceof RequestFailed) notify(error_.body.message, 'warning');
        });
    });
    const images = el('div', { class: 'attachments' });
    for (const attachment of topic.attachments) {
      images.append(
        el('img', {
          src: `/api/attachments/${attachment.id}`,
          alt: `Attachment on ${topic.title}`,
        }),
      );
    }
    const styleRow = el('div', { class: 'style-row' }, [
      this.iconPicker(id),
      this.colourPicker(id),
      this.lockButton(id),
      this.restrictButton(id),
    ]);
    this.body.append(
      el('label', { text: 'Note' }),
      area,
      error,
      preview,
      attach,
      picker,
      images,
      styleRow,
    );
  }

  private iconPicker(id: string): HTMLElement {
    const select = el('select', { 'aria-label': 'Icon' }, [
      el('option', { value: '', text: 'No icon' }),
      ...ICON_NAMES.map((name) => el('option', { value: name, text: name })),
    ]) as HTMLSelectElement;
    select.value = this.editor.doc.topics[id].icon ?? '';
    on(select, 'change', () => {
      this.editor.send([
        {
          op_id: nextId('o'),
          kind: 'style',
          topic_id: id,
          icon: select.value === '' ? null : select.value,
        },
      ]);
    });
    return el('label', {}, [el('span', { text: 'Icon' }), select]);
  }

  private colourPicker(id: string): HTMLElement {
    const input = el('input', { type: 'color', 'aria-label': 'Colour' }) as HTMLInputElement;
    input.value = colourHex(this.editor.derived().get(id)?.colour ?? 'accent');
    on(input, 'change', () => {
      const value = input.value.toLowerCase();
      this.editor.send([
        { op_id: nextId('o'), kind: 'custom_colour', colour: value },
        { op_id: nextId('o'), kind: 'style', topic_id: id, colour: value },
      ]);
    });
    return el('label', {}, [el('span', { text: 'Colour' }), input]);
  }

  private lockButton(id: string): HTMLElement {
    const lock = lockInfo(this.editor.doc, id);
    const locked = lock.by !== null;
    const button = el('button', {
      type: 'button',
      class: 'secondary',
      text: locked ? 'Unlock branch' : 'Lock branch',
    });
    on(button, 'click', () => {
      this.editor.send([
        { op_id: nextId('o'), kind: locked ? 'unlock' : 'lock', topic_id: id },
      ]);
    });
    return button;
  }

  private restrictButton(id: string): HTMLElement | null {
    if (!this.editor.canManage) return null;
    const restricted = this.editor.doc.topics[id].restricted;
    const button = el('button', {
      type: 'button',
      class: 'secondary',
      text: restricted ? 'Lift restriction' : 'Restrict branch',
    });
    on(button, 'click', () => {
      this.editor.send([
        { op_id: nextId('o'), kind: 'restrict', topic_id: id, restricted: !restricted },
      ]);
    });
    return button;
  }

  private paintTask(id: string): void {
    const topic = this.editor.doc.topics[id];
    const task = topic.task;
    const send = (ops: Operation[]): void => {
      this.editor.send(ops);
      this.update();
    };
    const taskBox = el('input', { type: 'checkbox', 'aria-label': 'Task' }) as HTMLInputElement;
    taskBox.checked = task !== null;
    on(taskBox, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: taskBox.checked ? {} : null,
        },
      ]);
    });
    this.body.append(el('label', {}, [taskBox, el('span', { text: 'Task' })]));
    if (!task) return;
    const done = el('input', { type: 'checkbox', 'aria-label': 'Done' }) as HTMLInputElement;
    done.checked = task.percent === 100;
    on(done, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: { percent: done.checked ? 100 : 0 },
        },
      ]);
    });
    const percent = el('input', {
      type: 'number',
      min: 0,
      max: 100,
      'aria-label': 'Percent done',
    }) as HTMLInputElement;
    percent.value = String(task.percent);
    on(percent, 'change', () => {
      send([
        { op_id: nextId('o'), kind: 'task', topic_id: id, task: { percent: Number(percent.value) } },
      ]);
    });
    const weight = el('input', {
      type: 'number',
      min: 0,
      max: 10,
      'aria-label': 'Weight',
    }) as HTMLInputElement;
    weight.value = String(task.weight);
    on(weight, 'change', () => {
      send([
        { op_id: nextId('o'), kind: 'task', topic_id: id, task: { weight: Number(weight.value) } },
      ]);
    });
    const priority = el('select', { 'aria-label': 'Priority' }, [
      el('option', { value: 'low', text: 'low' }),
      el('option', { value: 'normal', text: 'normal' }),
      el('option', { value: 'high', text: 'high' }),
    ]) as HTMLSelectElement;
    priority.value = task.priority;
    on(priority, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: { priority: priority.value as 'low' | 'normal' | 'high' },
        },
      ]);
    });
    const state = el('select', { 'aria-label': 'State' }, [
      el('option', { value: 'open', text: 'open' }),
      el('option', { value: 'cancelled', text: 'cancelled' }),
    ]) as HTMLSelectElement;
    state.value = task.state;
    on(state, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: { state: state.value as 'open' | 'cancelled' },
        },
      ]);
    });
    const people = ['', ...this.editor.members, this.editor.me];
    const assignee = el(
      'select',
      { 'aria-label': 'Assignee' },
      [...new Set(people)].map((name) => el('option', { value: name, text: name === '' ? 'Nobody' : name })),
    ) as HTMLSelectElement;
    assignee.value = task.assignee ?? '';
    on(assignee, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: { assignee: assignee.value === '' ? null : assignee.value },
        },
      ]);
    });
    const due = el('input', { type: 'date', 'aria-label': 'Due date' }) as HTMLInputElement;
    due.value = task.due ?? '';
    on(due, 'change', () => {
      send([
        {
          op_id: nextId('o'),
          kind: 'task',
          topic_id: id,
          task: { due: due.value === '' ? null : due.value },
        },
      ]);
    });
    this.body.append(
      el('label', {}, [done, el('span', { text: 'Done' })]),
      el('label', {}, [el('span', { text: 'Percent done' }), percent]),
      el('label', {}, [el('span', { text: 'Weight' }), weight]),
      el('label', {}, [el('span', { text: 'Priority' }), priority]),
      el('label', {}, [el('span', { text: 'State' }), state]),
      el('label', {}, [el('span', { text: 'Assignee' }), assignee]),
      el('label', {}, [el('span', { text: 'Due date' }), due]),
    );
  }

  private paintComments(id: string): void {
    const topic = this.editor.doc.topics[id];
    const list = el('div', { class: 'threads' });
    const counts = this.editor.countsFor(id);
    const voteButton = el('button', {
      type: 'button',
      class: 'secondary vote',
      'aria-label': `Vote for ${topic.title}`,
      'aria-pressed': counts.voted ? 'true' : 'false',
      text: `\u2605 ${counts.votes}`,
    });
    on(voteButton, 'click', () => {
      void api
        .put<{ vote_count: number; voted: boolean }>(
          `/api/maps/${this.editor.mapId}/topics/${id}/vote`,
          { voted: !counts.voted },
        )
        .then((answer) => {
          this.editor.counts.set(id, {
            comments: counts.comments,
            votes: answer.vote_count,
            voted: answer.voted,
          });
          this.editor.changed();
          this.update();
        })
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) notify(error.body.message, 'warning');
        });
    });
    const box = el('textarea', { 'aria-label': 'Add a comment', rows: 3 });
    const mentionList = el('div', { class: 'mention-list', role: 'listbox', 'aria-label': 'Mention' });
    mentionList.hidden = true;
    const names = [...new Set([...this.editor.members, this.editor.me])];
    on(box, 'input', () => {
      const match = /@([a-z0-9_]*)$/.exec(box.value);
      clear(mentionList);
      if (!match) {
        mentionList.hidden = true;
        return;
      }
      const matches = names.filter((name) => name.startsWith(match[1]));
      mentionList.hidden = matches.length === 0;
      for (const name of matches) {
        const option = el('div', { role: 'option', text: name, tabindex: '-1' });
        on(option, 'click', () => {
          box.value = box.value.replace(/@([a-z0-9_]*)$/, `@${name} `);
          mentionList.hidden = true;
          box.focus();
        });
        mentionList.append(option);
      }
    });
    on(box, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (mentionList.hidden) return;
      const options = [...mentionList.children] as HTMLElement[];
      const active = options.findIndex((option) => option.classList.contains('active'));
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, Math.min(options.length - 1, active + (key === 'ArrowDown' ? 1 : -1)));
        options.forEach((option, index) => option.classList.toggle('active', index === next));
        return;
      }
      if (key === 'Enter' && active >= 0) {
        event.preventDefault();
        options[active].click();
      }
    });
    const post = el('button', { type: 'button', class: 'primary', text: 'Post comment' });
    on(post, 'click', () => {
      const body = box.value.trim();
      if (body === '') return;
      void api
        .post(`/api/maps/${this.editor.mapId}/topics/${id}/comments`, { body, reply_to: null })
        .then(() => {
          box.value = '';
          return this.editor.refreshCounts();
        })
        .then(() => this.loadThreads(id, list))
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) notify(error.body.message, 'warning');
        });
    });
    this.body.append(
      voteButton,
      el('label', { text: 'Add a comment' }),
      box,
      mentionList,
      post,
      list,
    );
    void this.loadThreads(id, list);
  }

  private async loadThreads(id: string, host: HTMLElement): Promise<void> {
    interface Thread {
      id: string;
      author: string;
      body: string;
      resolved: boolean;
      replies: { id: string; author: string; body: string }[];
    }
    const answer = await api.get<{ threads: Thread[] }>(
      `/api/maps/${this.editor.mapId}/topics/${id}/comments`,
    );
    clear(host);
    for (const thread of answer.threads) {
      const replies = el(
        'div',
        { class: 'replies' },
        thread.replies.map((reply) =>
          el('p', { class: 'reply', text: `${reply.author}: ${reply.body}` }),
        ),
      );
      const reply = el('button', { type: 'button', class: 'secondary', text: 'Reply' });
      on(reply, 'click', () => {
        const box = el('textarea', { 'aria-label': 'Add a comment', rows: 2 });
        const send = el('button', { type: 'button', class: 'primary', text: 'Post comment' });
        on(send, 'click', () => {
          void api
            .post(`/api/maps/${this.editor.mapId}/topics/${id}/comments`, {
              body: box.value.trim(),
              reply_to: thread.id,
            })
            .then(() => this.loadThreads(id, host))
            .catch(() => undefined);
        });
        replies.append(box, send);
        box.focus();
      });
      const toggle = el('button', {
        type: 'button',
        class: 'secondary',
        text: thread.resolved ? 'Reopen' : 'Resolve',
      });
      on(toggle, 'click', () => {
        void api
          .post(`/api/comments/${thread.id}/${thread.resolved ? 'reopen' : 'resolve'}`)
          .then(() => this.editor.refreshCounts())
          .then(() => this.loadThreads(id, host))
          .catch((error: unknown) => {
            if (error instanceof RequestFailed) notify(error.body.message, 'warning');
          });
      });
      host.append(
        el('div', { class: `thread ${thread.resolved ? 'resolved' : ''}` }, [
          el('p', { class: 'comment', text: `${thread.author}: ${thread.body}` }),
          replies,
          el('div', { class: 'thread-actions' }, [reply, toggle]),
        ]),
      );
    }
  }
}

export class FindPanel {
  readonly node: HTMLElement;
  private readonly editor: Editor;
  private readonly view: CanvasView;
  private readonly actions: Actions;
  private readonly findBox: HTMLInputElement;
  private readonly replaceBox: HTMLInputElement;
  private readonly countText: HTMLElement;
  private matches: string[] = [];
  private current = 0;

  constructor(editor: Editor, view: CanvasView, actions: Actions) {
    this.editor = editor;
    this.view = view;
    this.actions = actions;
    this.findBox = el('input', { type: 'search', 'aria-label': 'Find' }) as HTMLInputElement;
    this.replaceBox = el('input', { type: 'text', 'aria-label': 'Replace with' }) as HTMLInputElement;
    this.countText = el('span', { class: 'find-count', text: copy.noMatches });
    const next = el('button', { type: 'button', class: 'secondary', text: 'Next match' });
    const previous = el('button', { type: 'button', class: 'secondary', text: 'Previous match' });
    const replaceAll = el('button', { type: 'button', class: 'secondary', text: 'Replace all' });
    on(this.findBox, 'input', () => this.search());
    on(next, 'click', () => this.step(1));
    on(previous, 'click', () => this.step(-1));
    on(replaceAll, 'click', () => this.replaceAll());
    const assignee = this.filter('Filter by assignee', () => [
      '',
      ...new Set(
        Object.values(this.editor.doc.topics)
          .map((topic) => topic.task?.assignee ?? '')
          .filter((name) => name !== ''),
      ),
    ]);
    const icon = this.filter('Filter by icon', () => ['', ...ICON_NAMES]);
    const taskState = this.filter('Filter by task state', () => ['', 'open', 'cancelled']);
    this.node = el('div', { class: 'find', role: 'search', 'aria-label': 'Find in map' }, [
      el('label', {}, [el('span', { text: 'Find' }), this.findBox]),
      el('label', {}, [el('span', { text: 'Replace with' }), this.replaceBox]),
      this.countText,
      el('div', { class: 'find-actions' }, [previous, next, replaceAll]),
      assignee,
      icon,
      taskState,
    ]);
    on(this.node, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') return;
      event.preventDefault();
      this.clear();
      this.view.focusTopic(this.editor.focusId);
    });
  }

  private filter(label: string, options: () => string[]): HTMLElement {
    const select = el('select', { 'aria-label': label }) as HTMLSelectElement;
    const paint = (): void => {
      clear(select);
      for (const option of options()) {
        select.append(el('option', { value: option, text: option === '' ? 'Everyone' : option }));
      }
    };
    paint();
    on(select, 'focus', paint);
    on(select, 'change', () => {
      this.editor.dimmed.clear();
      if (select.value !== '') {
        for (const id of visibleTopics(this.editor.view())) {
          const topic = this.editor.doc.topics[id];
          const value =
            label === 'Filter by assignee'
              ? (topic.task?.assignee ?? '')
              : label === 'Filter by icon'
                ? (topic.icon ?? '')
                : (topic.task?.state ?? '');
          if (value !== select.value) this.editor.dimmed.add(id);
        }
      }
      this.editor.changed();
    });
    return el('label', {}, [el('span', { text: label }), select]);
  }

  focus(): void {
    this.findBox.focus();
  }

  clear(): void {
    this.editor.dimmed.clear();
    this.editor.changed();
  }

  private search(): void {
    const needle = this.findBox.value.toLowerCase();
    this.editor.dimmed.clear();
    this.matches = [];
    if (needle === '') {
      this.countText.textContent = copy.noMatches;
      this.editor.changed();
      return;
    }
    for (const id of Object.keys(this.editor.doc.topics)) {
      const topic = this.editor.doc.topics[id];
      const hit =
        topic.title.toLowerCase().includes(needle) || topic.note.toLowerCase().includes(needle);
      if (hit) this.matches.push(id);
    }
    const order = visibleTopics({
      doc: this.editor.doc,
      collapsed: new Set(),
      hidden: new Set(),
    });
    this.matches.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const id of visibleTopics(this.editor.view())) {
      if (!this.matches.includes(id)) this.editor.dimmed.add(id);
    }
    this.current = 0;
    if (this.matches.length > 0) {
      for (const ancestor of this.editor.ancestorsOf(this.matches[0])) {
        if (this.editor.collapsed.has(ancestor)) this.editor.setCollapsed(ancestor, false);
      }
    }
    this.countText.textContent = copy.findCount(
      this.matches.length === 0 ? 0 : 1,
      this.matches.length,
    );
    announce(this.countText.textContent);
    this.editor.changed();
  }

  private step(direction: 1 | -1): void {
    if (this.matches.length === 0) return;
    this.current = (this.current + direction + this.matches.length) % this.matches.length;
    const id = this.matches[this.current];
    for (const ancestor of this.editor.ancestorsOf(id)) {
      if (this.editor.collapsed.has(ancestor)) this.editor.setCollapsed(ancestor, false);
    }
    this.countText.textContent = copy.findCount(this.current + 1, this.matches.length);
    this.view.focusTopic(id);
  }

  /** Replace all is one undoable group that skips locked topics. */
  private replaceAll(): void {
    const find = this.findBox.value;
    const replace = this.replaceBox.value;
    if (find === '') return;
    const ops: Operation[] = [];
    let skipped = 0;
    const touched = new Set<string>();
    for (const id of Object.keys(this.editor.doc.topics)) {
      const topic = this.editor.doc.topics[id];
      const inTitle = topic.title.toLowerCase().includes(find.toLowerCase());
      const inNote = topic.note.toLowerCase().includes(find.toLowerCase());
      if (!inTitle && !inNote) continue;
      const lock = lockInfo(this.editor.doc, id);
      if (lock.by !== null && lock.by !== this.editor.me && this.editor.role !== 'owner') {
        skipped += 1;
        continue;
      }
      touched.add(id);
      if (inTitle) {
        ops.push({
          op_id: nextId('o'),
          kind: 'title',
          topic_id: id,
          offset: 0,
          delete: [...topic.title].length,
          insert: replaceEvery(topic.title, find, replace),
        });
      }
      if (inNote) {
        ops.push({
          op_id: nextId('o'),
          kind: 'note',
          topic_id: id,
          text: replaceEvery(topic.note, find, replace),
        });
      }
    }
    if (ops.length > 0) this.editor.send(ops);
    notify(copy.replaced(touched.size, skipped));
    this.actions.clearSelection();
    this.search();
  }
}

function replaceEvery(value: string, find: string, replace: string): string {
  let out = '';
  let rest = value;
  const needle = find.toLowerCase();
  while (rest.length > 0) {
    const at = rest.toLowerCase().indexOf(needle);
    if (at < 0) {
      out += rest;
      break;
    }
    out += rest.slice(0, at) + replace;
    rest = rest.slice(at + find.length);
  }
  return out;
}

export class ActivityPanel {
  readonly node: HTMLElement;
  private readonly editor: Editor;
  private readonly view: CanvasView;
  private readonly rows: HTMLElement;
  private readonly person: HTMLSelectElement;

  constructor(editor: Editor, view: CanvasView) {
    this.editor = editor;
    this.view = view;
    this.rows = el('div', { class: 'activity-rows' });
    this.person = el('select', { 'aria-label': 'Person' }) as HTMLSelectElement;
    on(this.person, 'change', () => {
      void this.editor.loadActivity(this.person.value).then(() => this.update());
    });
    this.node = el('div', { class: 'activity', role: 'region', 'aria-label': 'Activity' }, [
      el('label', {}, [el('span', { text: 'Person' }), this.person]),
      this.rows,
    ]);
  }

  async load(): Promise<void> {
    await this.editor.loadActivity(null);
    this.update();
  }

  update(): void {
    const names = [
      'Everyone',
      ...new Set([this.editor.me, ...this.editor.activity.map((row) => row.user)]),
    ];
    const chosen = this.person.value;
    clear(this.person);
    for (const name of names) this.person.append(el('option', { value: name, text: name }));
    this.person.value = names.includes(chosen) ? chosen : 'Everyone';
    clear(this.rows);
    for (const row of this.editor.activity) {
      const button = el('button', { type: 'button', class: 'activity-row', text: row.sentence });
      on(button, 'click', () => {
        if (row.topic_id === null || !this.editor.doc.topics[row.topic_id]) {
          notify(copy.missingTopic, 'warning');
          return;
        }
        this.view.focusTopic(row.topic_id);
      });
      this.rows.append(button);
    }
  }
}

export class RecoveredBand {
  readonly node: HTMLElement;
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    this.node = el('div', { class: 'recovered-band' });
  }

  update(): void {
    clear(this.node);
    if (this.editor.recovered.length === 0) return;
    const region = el('div', { role: 'region', 'aria-label': 'Recovered edits', class: 'notice-band' }, [
      el('h2', { text: 'Recovered edits' }),
    ]);
    for (const entry of this.editor.recovered) {
      const reapply = el('button', { type: 'button', class: 'primary', text: 'Re-apply' });
      const dismiss = el('button', { type: 'button', class: 'secondary', text: 'Dismiss' });
      on(reapply, 'click', () => {
        void api
          .post(`/api/maps/${this.editor.mapId}/recovered/${entry.id}/reapply`)
          .then(() => this.editor.resync())
          .catch((error: unknown) => {
            if (error instanceof RequestFailed) notify(error.body.message, 'warning');
          });
      });
      on(dismiss, 'click', () => {
        void api
          .del(`/api/maps/${this.editor.mapId}/recovered/${entry.id}`)
          .then(() => this.editor.resync())
          .catch(() => undefined);
      });
      region.append(
        el('div', { class: 'recovered-entry' }, [
          el('p', { text: `${entry.text} (from ${entry.from_title})` }),
          reapply,
          dismiss,
        ]),
      );
    }
    this.node.append(region);
  }
}

export class PeopleList {
  readonly node: HTMLElement;
  private readonly editor: Editor;
  private readonly view: CanvasView;

  constructor(editor: Editor, view: CanvasView) {
    this.editor = editor;
    this.view = view;
    this.node = el('ul', { class: 'people', 'aria-label': 'People here' });
  }

  update(): void {
    clear(this.node);
    for (const person of this.editor.people) {
      const row = el('li', {}, [
        el('span', { class: 'person-dot', 'aria-hidden': 'true' }),
        el('span', { text: `${person.name}${person.guest ? ' (guest)' : ''} \u00b7 ${person.role}` }),
      ]);
      (row.firstElementChild as HTMLElement).style.background = colourHex(person.colour);
      if (person.name !== this.editor.me) {
        const follow = el('button', {
          type: 'button',
          class: 'secondary',
          text: `Follow ${person.name}`,
        });
        on(follow, 'click', () => {
          this.editor.following = person.name;
          announce(copy.following(person.name));
          this.followNow(person.name);
        });
        row.append(follow);
      }
      this.node.append(row);
    }
    if (this.editor.following !== null) this.followNow(this.editor.following);
  }

  private followNow(name: string): void {
    const person = this.editor.people.find((each) => each.name === name);
    if (!person?.view) return;
    this.editor.zoom = person.view.zoom;
    const centreX = (person.view.width / 2 - person.view.pan_x) / person.view.zoom;
    const centreY = (person.view.height / 2 - person.view.pan_y) / person.view.zoom;
    this.editor.panX = this.editor.canvasWidth / 2 - centreX * this.editor.zoom;
    this.editor.panY = this.editor.canvasHeight / 2 - centreY * this.editor.zoom;
    this.view.update();
  }
}
