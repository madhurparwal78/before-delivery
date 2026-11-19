import { copy } from '../../shared/copy.js';
import { on } from '../dom.js';
import { announce, notify } from '../shell.js';
import type { Actions } from './actions.js';
import type { Editor } from './state.js';
import type { CanvasView } from './view.js';

const EDIT_KEYS = new Set(['Tab', 'Enter', 'F2', 'Delete', 'Backspace']);

export interface PanelCycle {
  toolbar: () => HTMLElement | null;
  panels: () => HTMLElement[];
}

export class Input {
  private readonly editor: Editor;
  private readonly view: CanvasView;
  private readonly actions: Actions;
  private readonly cycle: PanelCycle;
  private dragging: { id: string; startX: number; startY: number; active: boolean } | null = null;
  private panning: { startX: number; startY: number; panX: number; panY: number } | null = null;
  private pinch: { distance: number; zoom: number } | null = null;
  private longPress: number | null = null;
  private edgePan: number | null = null;

  constructor(editor: Editor, view: CanvasView, actions: Actions, cycle: PanelCycle) {
    this.editor = editor;
    this.view = view;
    this.actions = actions;
    this.cycle = cycle;
    this.wireKeyboard();
    this.wirePointer();
    this.wireTouch();
  }

  private topicFrom(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const node = target.closest('[data-topic-id]');
    return node?.getAttribute('data-topic-id') ?? null;
  }

  private topicUnder(x: number, y: number, exclude: Set<string>): string | null {
    const found = document.elementsFromPoint(x, y);
    for (const node of found) {
      const id = node instanceof Element ? node.closest('[data-topic-id]')?.getAttribute('data-topic-id') : null;
      if (id && !exclude.has(id)) return id;
    }
    return null;
  }

  private wireKeyboard(): void {
    // F6 works from any region, so focus is never trapped in the tree.
    on(document, 'keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.key !== 'F6') return;
      if (document.querySelector('.scrim') !== null) return;
      event.preventDefault();
      this.moveRegion(e.shiftKey ? -1 : 1);
    });
    on(this.view.tree, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      const e = event as KeyboardEvent;
      if (this.actions.editing) return;
      const id = this.editor.focusId;
      const readOnly = !this.editor.canEdit;

      if (e.ctrlKey || e.metaKey) {
        if (key === 'z' || key === 'Z') {
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          void (e.shiftKey ? this.editor.redo() : this.editor.undo());
          return;
        }
        if (key === 'y') {
          event.preventDefault();
          void this.editor.redo();
          return;
        }
        if (key === 'c' || key === 'C') {
          event.preventDefault();
          void this.actions.copySelection();
          return;
        }
        if (key === 'v' || key === 'V') {
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          void this.actions.paste();
          return;
        }
        if (key === 'f' || key === 'F') {
          event.preventDefault();
          if (e.shiftKey) this.actions.onFocusBranch?.(this.editor.focusId);
          else this.actions.onOpenFind?.();
          return;
        }
        if (e.shiftKey && (key === 'l' || key === 'L')) {
          event.preventDefault();
          this.actions.onOpenCrossLink?.();
          return;
        }
        if (e.shiftKey && (key === 'b' || key === 'B')) {
          event.preventDefault();
          this.editor.send([
            {
              op_id: `o-${Date.now().toString(36)}`,
              kind: 'boundary_add',
              boundary_id: `b-${Date.now().toString(36)}`,
              topic_id: id,
              label: '',
            },
          ]);
          return;
        }
        return;
      }

      if (e.altKey) {
        if (key === 'Enter') {
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          this.actions.addFloating();
          return;
        }
        if (key.startsWith('Arrow')) {
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          if (e.shiftKey) this.actions.moveFloating(key);
          else this.actions.keyboardMove(key);
          return;
        }
        return;
      }

      if (e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
        event.preventDefault();
        this.actions.extendSelection(key === 'ArrowUp' ? -1 : 1);
        return;
      }

      switch (key) {
        case 'Tab':
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          this.actions.addChild(id);
          return;
        case 'Enter':
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          this.actions.addSibling(id);
          return;
        case 'F2':
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          this.actions.openTitleInput(id, 'rename');
          return;
        case 'Delete':
          event.preventDefault();
          if (readOnly) {
            notify(copy.readOnly);
            return;
          }
          this.actions.remove(this.actions.selectionOrFocus());
          return;
        case ' ':
          event.preventDefault();
          this.actions.toggleCollapse(id);
          return;
        case 'Home':
          event.preventDefault();
          this.actions.focusHome();
          return;
        case 'End':
          event.preventDefault();
          this.actions.focusEnd();
          return;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          event.preventDefault();
          this.actions.clearSelection();
          this.actions.moveFocus(key);
          return;
        case 'Escape':
          this.actions.clearSelection();
          return;
        default:
          break;
      }

      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !EDIT_KEYS.has(key)) {
        event.preventDefault();
        if (readOnly) {
          notify(copy.readOnly);
          return;
        }
        this.actions.openTitleInput(id, 'typed', key);
      }
    });
  }

  private moveRegion(direction: number): void {
    const regions = [this.view.tree, this.cycle.toolbar(), ...this.cycle.panels()].filter(
      (node): node is HTMLElement => node !== null,
    );
    const active = document.activeElement;
    const current = regions.findIndex((region) => region.contains(active));
    const next = regions[(current + direction + regions.length) % regions.length];
    if (!next) return;
    if (next === this.view.tree) {
      this.view.focusTopic(this.editor.focusId);
      return;
    }
    const focusable = next.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex="0"]',
    );
    (focusable ?? next).focus();
  }

  private wirePointer(): void {
    on(this.view.region, 'pointerdown', (event) => {
      const pointer = event as PointerEvent;
      if (pointer.pointerType === 'touch') return;
      const id = this.topicFrom(pointer.target);
      if (id === null) {
        this.panning = {
          startX: pointer.clientX,
          startY: pointer.clientY,
          panX: this.editor.panX,
          panY: this.editor.panY,
        };
        return;
      }
      if (pointer.ctrlKey || pointer.metaKey) {
        this.actions.toggleSelect(id);
        return;
      }
      this.actions.clearSelection();
      this.view.focusTopic(id);
      this.dragging = { id, startX: pointer.clientX, startY: pointer.clientY, active: false };
    });
    on(window, 'pointermove', (event) => {
      const pointer = event as PointerEvent;
      if (this.panning) {
        this.editor.panX = this.panning.panX + (pointer.clientX - this.panning.startX);
        this.editor.panY = this.panning.panY + (pointer.clientY - this.panning.startY);
        this.stopFollowing();
        this.editor.changed();
        return;
      }
      if (!this.dragging) return;
      const dx = pointer.clientX - this.dragging.startX;
      const dy = pointer.clientY - this.dragging.startY;
      if (!this.dragging.active && Math.hypot(dx, dy) <= 8) return;
      this.dragging.active = true;
      this.updateDropTarget(pointer.clientX, pointer.clientY);
    });
    on(window, 'pointerup', (event) => {
      const pointer = event as PointerEvent;
      this.panning = null;
      if (this.dragging?.active) this.finishDrag(pointer.clientX, pointer.clientY);
      else if (this.dragging) this.actions.onTopicSelected?.(this.dragging.id);
      this.dragging = null;
    });
    on(this.view.region, 'contextmenu', (event) => {
      const id = this.topicFrom(event.target);
      if (id === null) return;
      event.preventDefault();
      this.view.focusTopic(id);
      const pointer = event as MouseEvent;
      this.actions.onTopicMenu?.(id, { x: pointer.clientX, y: pointer.clientY });
    });
    on(this.view.region, 'dblclick', (event) => {
      const id = this.topicFrom(event.target);
      if (id !== null) this.actions.openTitleInput(id, 'rename');
    });
    on(this.view.region, 'wheel', (event) => {
      const wheel = event as WheelEvent;
      event.preventDefault();
      const rect = this.view.region.getBoundingClientRect();
      if (wheel.ctrlKey) {
        const factor = wheel.deltaY < 0 ? 1.1 : 1 / 1.1;
        this.view.zoomAbout(
          wheel.clientX - rect.left,
          wheel.clientY - rect.top,
          this.editor.zoom * factor,
        );
        this.stopFollowing();
        return;
      }
      this.editor.panX -= wheel.deltaX;
      this.editor.panY -= wheel.deltaY;
      this.stopFollowing();
      this.editor.changed();
    });
    on(this.view.region, 'pointermove', (event) => {
      const pointer = event as PointerEvent;
      const rect = this.view.region.getBoundingClientRect();
      this.editor.sendCursor(pointer.clientX - rect.left, pointer.clientY - rect.top);
    });
  }

  private stopFollowing(): void {
    if (this.editor.following === null) return;
    const name = this.editor.following;
    this.editor.following = null;
    announce(copy.stoppedFollowing(name));
    this.editor.changed();
  }

  private updateDropTarget(x: number, y: number): void {
    const dragged = this.dragging;
    if (!dragged) return;
    const exclude = new Set(this.branch(dragged.id));
    const target = this.topicUnder(x, y, exclude);
    if (target !== this.editor.dropTarget) {
      this.editor.dropTarget = target;
      this.editor.changed();
      if (target !== null) {
        announce(
          copy.dropPreview(
            this.editor.doc.topics[dragged.id]?.title ?? '',
            this.editor.doc.topics[target]?.title ?? '',
          ),
        );
      }
    }
    this.startEdgePan(x, y);
  }

  private branch(id: string): string[] {
    const out: string[] = [];
    const walk = (each: string): void => {
      out.push(each);
      for (const child of this.editor.doc.topics[each]?.children ?? []) walk(child);
    };
    walk(id);
    return out;
  }

  private startEdgePan(x: number, y: number): void {
    const rect = this.view.region.getBoundingClientRect();
    const edge = 40;
    let dx = 0;
    let dy = 0;
    if (x - rect.left < edge) dx = 8;
    else if (rect.right - x < edge) dx = -8;
    if (y - rect.top < edge) dy = 8;
    else if (rect.bottom - y < edge) dy = -8;
    if (dx === 0 && dy === 0) {
      this.stopEdgePan();
      return;
    }
    if (this.edgePan !== null) return;
    this.edgePan = window.setInterval(() => {
      this.editor.panX += dx;
      this.editor.panY += dy;
      this.editor.changed();
    }, 16);
  }

  private stopEdgePan(): void {
    if (this.edgePan === null) return;
    window.clearInterval(this.edgePan);
    this.edgePan = null;
  }

  private finishDrag(x: number, y: number): void {
    this.stopEdgePan();
    const dragged = this.dragging;
    const target = this.editor.dropTarget;
    this.editor.dropTarget = null;
    if (!dragged) return;
    if (target === null) {
      this.editor.changed();
      return;
    }
    void x;
    void y;
    this.actions.reparent(dragged.id, target);
  }

  private wireTouch(): void {
    on(this.view.region, 'touchstart', (event) => {
      const touch = event as TouchEvent;
      if (touch.touches.length === 2) {
        const [a, b] = [touch.touches[0], touch.touches[1]];
        this.pinch = {
          distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          zoom: this.editor.zoom,
        };
        return;
      }
      const point = touch.touches[0];
      const id = this.topicFrom(point.target);
      if (id === null) {
        this.panning = {
          startX: point.clientX,
          startY: point.clientY,
          panX: this.editor.panX,
          panY: this.editor.panY,
        };
        return;
      }
      this.dragging = { id, startX: point.clientX, startY: point.clientY, active: false };
      this.longPress = window.setTimeout(() => {
        this.longPress = null;
        this.dragging = null;
        this.actions.onTopicMenu?.(id, { x: point.clientX, y: point.clientY });
      }, 500);
    });
    on(this.view.region, 'touchmove', (event) => {
      const touch = event as TouchEvent;
      if (this.pinch && touch.touches.length === 2) {
        event.preventDefault();
        const [a, b] = [touch.touches[0], touch.touches[1]];
        const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const rect = this.view.region.getBoundingClientRect();
        this.view.zoomAbout(
          (a.clientX + b.clientX) / 2 - rect.left,
          (a.clientY + b.clientY) / 2 - rect.top,
          this.pinch.zoom * (distance / this.pinch.distance),
        );
        return;
      }
      const point = touch.touches[0];
      if (!point) return;
      if (this.panning) {
        event.preventDefault();
        this.editor.panX = this.panning.panX + (point.clientX - this.panning.startX);
        this.editor.panY = this.panning.panY + (point.clientY - this.panning.startY);
        this.stopFollowing();
        this.editor.changed();
        return;
      }
      if (!this.dragging) return;
      const dx = point.clientX - this.dragging.startX;
      const dy = point.clientY - this.dragging.startY;
      if (Math.hypot(dx, dy) <= 8) return;
      if (this.longPress !== null) {
        window.clearTimeout(this.longPress);
        this.longPress = null;
      }
      event.preventDefault();
      this.dragging.active = true;
      this.updateDropTarget(point.clientX, point.clientY);
    });
    on(this.view.region, 'touchend', (event) => {
      const touch = event as TouchEvent;
      if (this.longPress !== null) {
        window.clearTimeout(this.longPress);
        this.longPress = null;
        if (this.dragging && !this.dragging.active) {
          this.actions.clearSelection();
          this.view.focusTopic(this.dragging.id);
          this.actions.onTopicSelected?.(this.dragging.id);
        }
      }
      const point = touch.changedTouches[0];
      if (this.dragging?.active && point) this.finishDrag(point.clientX, point.clientY);
      this.dragging = null;
      this.panning = null;
      this.pinch = null;
      this.stopEdgePan();
    });
  }
}
