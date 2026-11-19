import { copy } from '../../shared/copy.js';
import { NEW_TOPIC_TITLE } from '../../shared/ops.js';
import {
  applyTitleEdit,
  diffTitles,
  rebaseTitleEdit,
  transformCaret,
  type TitleEdit,
} from '../../shared/titlemerge.js';
import {
  branchIds,
  levelOf,
  lockInfo,
  permittedChildren,
  visibleTopics,
} from '../../shared/tree.js';
import type { Operation } from '../../shared/types.js';
import { el, on } from '../dom.js';
import { announce, notify } from '../shell.js';
import { nextId, type Editor } from './state.js';
import type { CanvasView } from './view.js';

export interface EditingInput {
  topicId: string;
  input: HTMLInputElement;
  titleAtOpen: string;
  baseRevision: number;
  isNew: boolean;
}

export class Actions {
  readonly editor: Editor;
  readonly view: CanvasView;
  editing: EditingInput | null = null;
  clipboardCount = 0;
  onOpenFind: (() => void) | null = null;
  onOpenCrossLink: (() => void) | null = null;
  onOpenDetails: ((id: string) => void) | null = null;
  onTopicSelected: ((id: string) => void) | null = null;
  onTopicMenu: ((id: string, at: { x: number; y: number }) => void) | null = null;
  onFocusBranch: ((id: string | null) => void) | null = null;

  constructor(editor: Editor, view: CanvasView) {
    this.editor = editor;
    this.view = view;
    editor.onRemoteTitle = (topicId, edit) => this.mergeIntoInput(topicId, edit);
    editor.onTopicsDeleted = (ids) => this.handleRemoteDelete(ids);
  }

  // ---- helpers ----------------------------------------------------------

  private readOnlyStop(): boolean {
    if (this.editor.canEdit) return false;
    notify(copy.readOnly);
    return true;
  }

  private siblingsOf(id: string): string[] {
    const topic = this.editor.doc.topics[id];
    if (!topic) return [];
    if (topic.parent_id === null) return topic.floating ? this.editor.doc.floating : [id];
    return this.editor.doc.topics[topic.parent_id]?.children ?? [];
  }

  private lastChildOf(id: string): string | null {
    const children = this.editor.doc.topics[id]?.children ?? [];
    return children.length > 0 ? children[children.length - 1] : null;
  }

  private lockedStop(id: string): boolean {
    const lock = lockInfo(this.editor.doc, id);
    if (lock.by === null || lock.by === this.editor.me || this.editor.role === 'owner') return false;
    notify(copy.lockedEdit(this.editor.doc.topics[id]?.title ?? '', lock.by), 'warning');
    return true;
  }

  visibleOrder(): string[] {
    const all = visibleTopics(this.editor.view());
    const shown = new Set(this.editor.visible());
    return all.filter((id) => shown.has(id));
  }

  // ---- structure -------------------------------------------------------

  addChild(id: string): void {
    if (this.readOnlyStop() || this.lockedStop(id)) return;
    const topicId = nextId('t');
    const ok = this.editor.send([
      {
        op_id: nextId('o'),
        kind: 'add',
        topic_id: topicId,
        parent_id: id,
        after: this.lastChildOf(id),
        title: NEW_TOPIC_TITLE,
      },
    ]);
    if (!ok) return;
    if (this.editor.collapsed.has(id)) this.editor.setCollapsed(id, false);
    this.view.focusTopic(topicId);
    this.openTitleInput(topicId, 'new');
  }

  addSibling(id: string): void {
    if (this.readOnlyStop()) return;
    const topic = this.editor.doc.topics[id];
    if (!topic || topic.parent_id === null) {
      this.addChild(this.editor.doc.root);
      return;
    }
    if (this.lockedStop(topic.parent_id)) return;
    const topicId = nextId('t');
    const ok = this.editor.send([
      {
        op_id: nextId('o'),
        kind: 'add',
        topic_id: topicId,
        parent_id: topic.parent_id,
        after: id,
        title: NEW_TOPIC_TITLE,
      },
    ]);
    if (!ok) return;
    this.view.focusTopic(topicId);
    this.openTitleInput(topicId, 'new');
  }

  addFloating(): void {
    if (this.readOnlyStop()) return;
    const topicId = nextId('f');
    const ok = this.editor.send([
      { op_id: nextId('o'), kind: 'add_floating', topic_id: topicId, title: NEW_TOPIC_TITLE },
    ]);
    if (!ok) return;
    this.view.focusTopic(topicId);
    this.openTitleInput(topicId, 'new');
  }

  remove(ids: string[]): void {
    if (this.readOnlyStop()) return;
    const targets = ids.filter((id) => this.editor.doc.topics[id]);
    if (targets.some((id) => id === this.editor.doc.root)) {
      notify(copy.rootDelete, 'warning');
      return;
    }
    for (const id of targets) {
      if (this.lockedStop(id)) return;
    }
    const first = targets[0];
    const nextFocus = this.focusAfterDelete(first);
    const ops: Operation[] = targets.map((id) => ({
      op_id: nextId('o'),
      kind: 'delete',
      topic_id: id,
    }));
    if (!this.editor.send(ops)) return;
    this.editor.selection.clear();
    this.view.focusTopic(this.editor.doc.topics[nextFocus] ? nextFocus : this.editor.doc.root);
  }

  focusAfterDelete(id: string): string {
    const siblings = this.siblingsOf(id);
    const index = siblings.indexOf(id);
    if (index >= 0 && siblings[index + 1]) return siblings[index + 1];
    if (index > 0) return siblings[index - 1];
    return this.editor.doc.topics[id]?.parent_id ?? this.editor.doc.root;
  }

  toggleCollapse(id: string): void {
    const children = permittedChildren(this.editor.view(), id);
    if (children.length === 0) return;
    const collapsed = !this.editor.collapsed.has(id);
    this.editor.setCollapsed(id, collapsed);
    const title = this.editor.doc.topics[id]?.title ?? '';
    announce(collapsed ? copy.collapsed(title) : copy.expanded(title));
  }

  // ---- titles ----------------------------------------------------------

  openTitleInput(id: string, mode: 'new' | 'rename' | 'typed', typed = ''): void {
    if (this.readOnlyStop() || this.lockedStop(id)) return;
    const node = this.view.elementFor(id);
    const topic = this.editor.doc.topics[id];
    if (!node || !topic) return;
    this.closeTitleInput(false);
    const input = el('input', { type: 'text', class: 'title-input', 'aria-label': 'Title' });
    input.value = mode === 'typed' ? typed : topic.title;
    this.editing = {
      topicId: id,
      input,
      titleAtOpen: topic.title,
      baseRevision: this.editor.revision,
      isNew: mode === 'new',
    };
    this.editor.editingTopic = id;
    node.textContent = '';
    node.append(input);
    input.focus({ preventScroll: true });
    if (mode === 'new') input.select();
    else if (mode === 'rename') input.setSelectionRange(input.value.length, input.value.length);
    else input.setSelectionRange(input.value.length, input.value.length);
    on(input, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.commitTitle();
      } else if (key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.cancelTitle();
      } else {
        event.stopPropagation();
      }
    });
    on(input, 'blur', () => {
      if (this.editing?.input === input) this.commitTitle();
    });
  }

  commitTitle(): void {
    const editing = this.editing;
    if (!editing) return;
    const value = editing.input.value.trim();
    this.editing = null;
    this.editor.editingTopic = null;
    const current = this.editor.doc.topics[editing.topicId];
    if (value !== '' && current && value !== current.title) {
      const edit = diffTitles(editing.titleAtOpen, value);
      this.editor.send([
        {
          op_id: nextId('o'),
          kind: 'title',
          topic_id: editing.topicId,
          offset: edit.offset,
          delete: edit.delete,
          insert: edit.insert,
        },
      ]);
    }
    this.editor.changed();
    this.view.focusTopic(editing.topicId);
  }

  cancelTitle(): void {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    this.editor.editingTopic = null;
    this.editor.changed();
    this.view.focusTopic(editing.topicId);
  }

  closeTitleInput(commit: boolean): void {
    if (!this.editing) return;
    if (commit) this.commitTitle();
    else {
      this.editing = null;
      this.editor.editingTopic = null;
    }
  }

  /** Takes a remote title edit into an open title input. */
  private mergeIntoInput(topicId: string, remote: TitleEdit): void {
    const editing = this.editing;
    if (!editing || editing.topicId !== topicId) return;
    const before = this.editor.doc.topics[topicId]?.title ?? '';
    const remoteTitle = applyTitleEdit(before, remote);
    if (editing.input.value === editing.titleAtOpen) {
      const caret = editing.input.selectionStart ?? editing.input.value.length;
      editing.input.value = remoteTitle;
      const moved = transformCaret(caret, remote);
      editing.input.setSelectionRange(moved, moved);
      editing.titleAtOpen = remoteTitle;
      return;
    }
    const pending = diffTitles(editing.titleAtOpen, editing.input.value);
    const moved = rebaseTitleEdit(pending, [remote]);
    editing.input.value = applyTitleEdit(remoteTitle, moved);
    editing.titleAtOpen = remoteTitle;
    const caret = moved.offset + [...moved.insert].length;
    editing.input.setSelectionRange(caret, caret);
  }

  /** The delete wins: the open text is sent and lands in Recovered edits. */
  private handleRemoteDelete(ids: string[]): void {
    const editing = this.editing;
    if (!editing || !ids.includes(editing.topicId)) return;
    const value = editing.input.value.trim();
    const edit = diffTitles(editing.titleAtOpen, value);
    const focus = this.focusAfterDelete(editing.topicId);
    this.editing = null;
    this.editor.editingTopic = null;
    this.editor.sendDespiteDelete([
      {
        op_id: nextId('o'),
        kind: 'title',
        topic_id: editing.topicId,
        offset: edit.offset,
        delete: edit.delete,
        insert: edit.insert,
      },
    ], editing.baseRevision);
    this.view.focusTopic(this.editor.doc.topics[focus] ? focus : this.editor.doc.root);
  }

  // ---- navigation ------------------------------------------------------

  private firstVisibleChild(id: string): string | null {
    if (this.editor.collapsed.has(id)) return null;
    const children = permittedChildren(this.editor.view(), id);
    return children[0] ?? null;
  }

  private expandTowards(id: string): boolean {
    if (!this.editor.collapsed.has(id)) return false;
    if (permittedChildren(this.editor.view(), id).length === 0) return false;
    this.editor.setCollapsed(id, false);
    announce(copy.expanded(this.editor.doc.topics[id]?.title ?? ''));
    return true;
  }

  moveFocus(key: string): void {
    const id = this.editor.focusId;
    const topic = this.editor.doc.topics[id];
    if (!topic) return;
    const layout = this.editor.doc.layout;
    const side = this.view.elementFor(id)?.dataset.side ?? 'none';
    const siblings = this.siblingsOf(id);
    const index = siblings.indexOf(id);
    const order = this.visibleOrder();
    const place = order.indexOf(id);
    let target: string | null = null;
    let towardsChildren = false;

    if (layout === 'map') {
      if (key === 'ArrowUp') target = index > 0 ? siblings[index - 1] : null;
      else if (key === 'ArrowDown') target = siblings[index + 1] ?? null;
      else if (id === this.editor.doc.root) {
        const children = permittedChildren(this.editor.view(), id);
        const wanted = key === 'ArrowRight' ? 'right' : 'left';
        target =
          children.find((child) => this.view.elementFor(child)?.dataset.side === wanted) ?? null;
        towardsChildren = true;
      } else if ((key === 'ArrowRight' && side === 'right') || (key === 'ArrowLeft' && side === 'left')) {
        towardsChildren = true;
        target = this.firstVisibleChild(id);
      } else if ((key === 'ArrowLeft' && side === 'right') || (key === 'ArrowRight' && side === 'left')) {
        target = topic.parent_id;
      }
    } else if (layout === 'org') {
      if (key === 'ArrowDown') {
        towardsChildren = true;
        target = this.firstVisibleChild(id);
      } else if (key === 'ArrowUp') target = topic.parent_id;
      else if (key === 'ArrowLeft') target = index > 0 ? siblings[index - 1] : null;
      else if (key === 'ArrowRight') target = siblings[index + 1] ?? null;
    } else {
      if (key === 'ArrowDown') target = order[place + 1] ?? null;
      else if (key === 'ArrowUp') target = order[place - 1] ?? null;
      else if (key === 'ArrowRight') {
        towardsChildren = true;
        target = this.firstVisibleChild(id);
      } else if (key === 'ArrowLeft') target = topic.parent_id;
    }

    if (towardsChildren && target === null && this.expandTowards(id)) return;
    if (target === null || !this.editor.doc.topics[target]) return;
    this.editor.selection.clear();
    this.view.focusTopic(target);
  }

  focusHome(): void {
    this.view.focusTopic(this.editor.doc.root);
  }

  focusEnd(): void {
    const order = this.visibleOrder();
    const last = order[order.length - 1];
    if (last) this.view.focusTopic(last);
  }

  // ---- moves -----------------------------------------------------------

  private moveGroup(ids: string[], parentId: string, after: string | null): boolean {
    const ops: Operation[] = [];
    let anchor = after;
    for (const id of ids) {
      ops.push({ op_id: nextId('o'), kind: 'move', topic_id: id, parent_id: parentId, after: anchor });
      anchor = id;
    }
    return this.editor.send(ops);
  }

  private announceMove(id: string): void {
    const topic = this.editor.doc.topics[id];
    if (!topic || topic.parent_id === null) return;
    const siblings = this.editor.doc.topics[topic.parent_id]?.children ?? [];
    announce(
      copy.movePosition(
        topic.title,
        siblings.indexOf(id) + 1,
        siblings.length,
        this.editor.doc.topics[topic.parent_id]?.title ?? '',
      ),
    );
  }

  private cannotMove(id: string): void {
    announce(copy.cannotMove(this.editor.doc.topics[id]?.title ?? ''));
  }

  reorder(ids: string[], direction: -1 | 1): void {
    if (this.readOnlyStop()) return;
    const first = ids[0];
    const topic = this.editor.doc.topics[first];
    if (!topic || topic.floating || topic.parent_id === null) {
      this.cannotMove(first);
      return;
    }
    const siblings = [...(this.editor.doc.topics[topic.parent_id]?.children ?? [])];
    const indices = ids.map((id) => siblings.indexOf(id)).sort((a, b) => a - b);
    if (direction === -1) {
      const top = indices[0];
      if (top <= 0) {
        this.cannotMove(first);
        return;
      }
      const after = top - 2 >= 0 ? siblings[top - 2] : null;
      if (!this.moveGroup(ids, topic.parent_id, after)) return;
    } else {
      const bottom = indices[indices.length - 1];
      if (bottom >= siblings.length - 1) {
        this.cannotMove(first);
        return;
      }
      if (!this.moveGroup(ids, topic.parent_id, siblings[bottom + 1])) return;
    }
    this.announceMove(first);
    this.view.focusTopic(this.editor.focusId);
  }

  demote(ids: string[]): void {
    if (this.readOnlyStop()) return;
    const first = ids[0];
    const topic = this.editor.doc.topics[first];
    if (!topic || topic.parent_id === null) {
      this.cannotMove(first);
      return;
    }
    const siblings = this.editor.doc.topics[topic.parent_id]?.children ?? [];
    const index = siblings.indexOf(first);
    const previous = index > 0 ? siblings[index - 1] : null;
    if (previous === null) {
      this.cannotMove(first);
      return;
    }
    if (this.editor.collapsed.has(previous)) this.editor.setCollapsed(previous, false);
    if (!this.moveGroup(ids, previous, this.lastChildOf(previous))) return;
    this.announceMove(first);
    this.view.focusTopic(this.editor.focusId);
  }

  outdent(ids: string[]): void {
    if (this.readOnlyStop()) return;
    const first = ids[0];
    const topic = this.editor.doc.topics[first];
    if (!topic || topic.parent_id === null) {
      this.cannotMove(first);
      return;
    }
    if (this.editor.doc.layout === 'map' && levelOf(this.editor.doc, first) === 2) {
      this.pinOtherSide(first);
      return;
    }
    const parent = this.editor.doc.topics[topic.parent_id];
    if (!parent || parent.parent_id === null) {
      this.cannotMove(first);
      return;
    }
    if (!this.moveGroup(ids, parent.parent_id, parent.id)) return;
    this.announceMove(first);
    this.view.focusTopic(this.editor.focusId);
  }

  private pinOtherSide(id: string): void {
    const side = this.view.elementFor(id)?.dataset.side === 'left' ? 'right' : 'left';
    if (!this.editor.send([{ op_id: nextId('o'), kind: 'pin', topic_id: id, side }])) return;
    this.announceMove(id);
    this.view.focusTopic(id);
  }

  keyboardMove(key: string): void {
    const ids = this.selectionOrFocus();
    const layout = this.editor.doc.layout;
    const side = this.view.elementFor(ids[0])?.dataset.side ?? 'right';
    if (layout === 'map') {
      if (key === 'ArrowUp') return this.reorder(ids, -1);
      if (key === 'ArrowDown') return this.reorder(ids, 1);
      const towards = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
      if (key === towards) return this.demote(ids);
      return this.outdent(ids);
    }
    if (layout === 'org') {
      if (key === 'ArrowLeft') return this.reorder(ids, -1);
      if (key === 'ArrowRight') return this.reorder(ids, 1);
      if (key === 'ArrowDown') return this.demote(ids);
      return this.outdent(ids);
    }
    if (key === 'ArrowUp') return this.reorder(ids, -1);
    if (key === 'ArrowDown') return this.reorder(ids, 1);
    if (key === 'ArrowRight') return this.demote(ids);
    return this.outdent(ids);
  }

  moveFloating(key: string): void {
    const id = this.editor.focusId;
    const topic = this.editor.doc.topics[id];
    if (!topic?.floating) return;
    const step = 20;
    const deltas: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const delta = deltas[key];
    if (!delta) return;
    this.editor.send([
      {
        op_id: nextId('o'),
        kind: 'float_move',
        topic_id: id,
        x: (topic.x ?? 0) + delta[0],
        y: (topic.y ?? 0) + delta[1],
      },
    ]);
    this.view.focusTopic(id);
  }

  reparent(id: string, targetId: string): void {
    if (this.readOnlyStop()) return;
    if (id === targetId || branchIds(this.editor.doc, id).includes(targetId)) return;
    if (this.editor.collapsed.has(targetId)) this.editor.setCollapsed(targetId, false);
    if (!this.moveGroup([id], targetId, this.lastChildOf(targetId))) return;
    this.announceMove(id);
    this.view.focusTopic(id);
  }

  // ---- selection -------------------------------------------------------

  selectionOrFocus(): string[] {
    if (this.editor.selection.size === 0) return [this.editor.focusId];
    const order = this.visibleOrder();
    return order.filter((id) => this.editor.selection.has(id));
  }

  toggleSelect(id: string): void {
    if (this.editor.selection.has(id)) this.editor.selection.delete(id);
    else {
      if (this.editor.selection.size === 0) this.editor.selection.add(this.editor.focusId);
      this.editor.selection.add(id);
    }
    this.editor.focusId = id;
    announce(copy.selection(this.editor.selection.size));
    this.editor.changed();
  }

  extendSelection(direction: -1 | 1): void {
    const id = this.editor.focusId;
    const siblings = this.siblingsOf(id);
    const index = siblings.indexOf(id);
    const next = siblings[index + direction];
    if (next === undefined) return;
    if (this.editor.selection.size === 0) this.editor.selection.add(id);
    this.editor.selection.add(next);
    this.editor.focusId = next;
    announce(copy.selection(this.editor.selection.size));
    this.editor.changed();
    this.view.focusTopic(next);
  }

  clearSelection(): void {
    if (this.editor.selection.size === 0) return;
    this.editor.selection.clear();
    this.editor.changed();
  }

  // ---- clipboard -------------------------------------------------------

  async copySelection(): Promise<void> {
    const ids = this.selectionOrFocus();
    const answer = await this.editor.copyToClipboard(ids);
    this.clipboardCount = answer;
    notify(copy.copiedTopics(answer));
  }

  async paste(): Promise<void> {
    if (this.readOnlyStop()) return;
    const count = await this.editor.pasteClipboard(this.editor.focusId);
    if (count === null) {
      notify(copy.nothingToPaste, 'warning');
      return;
    }
    notify(copy.pastedTopics(count));
  }
}
