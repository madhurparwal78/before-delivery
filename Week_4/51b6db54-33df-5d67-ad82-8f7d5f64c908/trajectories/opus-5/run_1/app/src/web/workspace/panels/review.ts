import { api, refusalText, type ApiFailure } from '../../api.js';
import { button, clear, combobox, el, field, textbox, trapDialog } from '../../dom.js';

const ownerButton = (label: string, work: () => void): HTMLButtonElement =>
  button(label, work, { class: 'pill owner-only' });
import { num, relativeText } from '../../session.js';
import type { Workspace } from '../context.js';
import type { Panel } from './palette.js';

export interface CommentView {
  id: number;
  frame: number;
  x: number;
  y: number;
  text: string;
  state: string;
  author: string;
  mentions: { name: string; state: string }[];
}

export interface CommentsPanel extends Panel {
  comments(): CommentView[];
  openDialog(x: number, y: number): void;
  reload(): Promise<void>;
}

/** The Comments panel: pins, states, mentions and draft autosave. */
export function commentsPanel(ctx: Workspace): CommentsPanel {
  const list = el('div', { role: 'list', 'aria-label': 'Comments', class: 'comment-list' });
  let held: CommentView[] = [];

  const load = async (): Promise<void> => {
    const result = await api.get<{ comments: CommentView[] }>(
      `/api/sprites/${ctx.model.spriteId}/comments`,
    );
    held = result.ok ? result.body.comments : [];
    draw();
  };

  const changeState = async (comment: CommentView, to: 'resolve' | 'reopen'): Promise<void> => {
    const result = await api.post<ApiFailure>(`/api/comments/${comment.id}/${to}`);
    if (!result.ok) {
      ctx.regions.alert(refusalText(result));
      return;
    }
    await load();
    ctx.refreshPanels();
  };

  const draw = (): void => {
    clear(list);
    if (held.length === 0) {
      list.append(el('p', { class: 'empty-line', text: 'No comments yet' }));
      return;
    }
    for (const comment of held) {
      const row = el('div', { role: 'listitem', class: 'comment-row' }, [
        el('p', { class: 'comment-text', text: comment.text }),
        el('p', {
          class: 'comment-meta',
          text: `${comment.author} · frame ${num(comment.frame)} · ${comment.x}, ${comment.y} · ${comment.state}`,
        }),
      ]);
      for (const mention of comment.mentions) {
        row.append(
          el('p', {
            class: 'mention-line',
            text:
              mention.state === 'delivered'
                ? `Delivered to ${mention.name}`
                : `Sending to ${mention.name}`,
          }),
        );
      }
      row.append(
        comment.state === 'open'
          ? button('Resolve', () => void changeState(comment, 'resolve'))
          : button('Reopen', () => void changeState(comment, 'reopen')),
      );
      list.append(row);
    }
  };

  let draftText = '';
  let draftVersion = 0;
  const staleButtons: HTMLButtonElement[] = [];

  const loadNewerDraft = async (input?: HTMLInputElement): Promise<void> => {
    const draft = await api.get<{ text: string; version: number }>(
      `/api/drafts/comment:${ctx.model.spriteId}`,
    );
    if (!draft.ok) return;
    draftText = draft.body.text;
    draftVersion = draft.body.version;
    if (input !== undefined) input.value = draft.body.text;
    ctx.regions.draft('Saved');
    for (const node of staleButtons) node.hidden = true;
  };

  const newerButton = (input?: HTMLInputElement): HTMLButtonElement => {
    const node = button('Load newer', () => void loadNewerDraft(input));
    node.hidden = true;
    staleButtons.push(node);
    return node;
  };

  const panelNewer = newerButton();

  const openDialog = (x: number, y: number): void => {
    const input = textbox('Comment');
    input.value = draftText;
    const dialogNewer = newerButton(input);
    const dialog = el('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'New comment',
      class: 'dialog',
    });
    const shade = el('div', { class: 'shade' }, [dialog]);
    let release: (() => void) | null = null;
    const close = (): void => {
      release?.();
      shade.remove();
    };
    let autosave = 0;
    input.addEventListener('input', () => {
      draftText = input.value;
      window.clearTimeout(autosave);
      autosave = window.setTimeout(async () => {
        ctx.regions.draft('Saving…');
        const saved = await api.put<ApiFailure & { version: number }>(
          `/api/drafts/comment:${ctx.model.spriteId}`,
          { text: input.value, version: draftVersion },
        );
        if (!saved.ok) {
          ctx.regions.draft('A newer version exists');
          for (const node of staleButtons) node.hidden = false;
          return;
        }
        draftVersion = saved.body.version;
        ctx.regions.draft('Saved');
      }, Number(document.documentElement.dataset.autosaveMs ?? '1000'));
    });
    dialog.append(
      el('h2', { text: 'New comment' }),
      el('p', { class: 'hint', text: `Pinned at ${x}, ${y} on frame ${num(ctx.model.activeFrame)}` }),
      field('Comment', input),
      el('div', { class: 'row' }, [
        button('Post comment', async () => {
          ctx.regions.notice('Posting…');
          const result = await api.post<ApiFailure>(
            `/api/sprites/${ctx.model.spriteId}/comments`,
            { frame: ctx.model.activeFrame, x, y, text: input.value.trim() },
            { 'Idempotency-Key': `comment-${ctx.model.spriteId}-${x}-${y}-${input.value.length}-${Date.now()}` },
          );
          if (!result.ok) {
            ctx.regions.alert(refusalText(result));
            ctx.regions.notice('');
            return;
          }
          ctx.regions.notice('Comment posted');
          draftText = '';
          draftVersion = 0;
          close();
          await load();
          ctx.refreshPanels();
        }),
        button('Close', close),
      ]),
      dialogNewer,
    );
    document.body.append(shade);
    release = trapDialog(dialog, close);
  };

  const body = el('div', { class: 'panel-body' }, [
    list,
    button('Pin comment', () => {
      ctx.pinMode = true;
      ctx.regions.notice('');
    }),
    panelNewer,
  ]);

  void load();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Comments', class: 'panel panel-cornflower' }, [
      el('h2', { class: 'panel-title', text: 'Comments' }),
      body,
    ]),
    refresh: draw,
    comments: () => held,
    openDialog,
    reload: load,
  };
}

/** The Snapshots panel: named captures, comparing and restoring. */
export function snapshotsPanel(ctx: Workspace): Panel {
  const nameInput = textbox('Snapshot name');
  const list = el('div', { role: 'list', 'aria-label': 'Snapshots', class: 'snapshot-list' });
  const fromSelect = combobox('From', []);
  const toSelect = combobox('To', []);
  const changes = el('div', { role: 'list', 'aria-label': 'Snapshot changes', class: 'change-list' });
  let held: { id: number; name: string; seq: number; at: string }[] = [];

  const load = async (): Promise<void> => {
    const result = await api.get<{ snapshots: typeof held }>(
      `/api/sprites/${ctx.model.spriteId}/snapshots`,
    );
    held = result.ok ? result.body.snapshots : [];
    draw();
  };

  const compare = async (): Promise<void> => {
    if (fromSelect.value === '' || toSelect.value === '') return;
    const result = await api.get<{
      frames: { frame: number; changed: number; cells: { x: number; y: number }[] }[];
    }>(
      `/api/sprites/${ctx.model.spriteId}/snapshots/compare?from=${fromSelect.value}&to=${toSelect.value}`,
    );
    clear(changes);
    if (!result.ok) {
      changes.append(el('p', { class: 'empty-line', text: 'Nothing to compare' }));
      return;
    }
    if (result.body.frames.length === 0) {
      changes.append(el('p', { class: 'empty-line', text: 'No changes' }));
      return;
    }
    for (const frame of result.body.frames) {
      changes.append(
        el('p', {
          role: 'listitem',
          text: `${num(frame.changed)} ${frame.changed === 1 ? 'pixel' : 'pixels'} changed in frame ${num(frame.frame)}`,
        }),
      );
    }
  };

  fromSelect.addEventListener('change', () => void compare());
  toSelect.addEventListener('change', () => void compare());

  const draw = (): void => {
    clear(list);
    if (held.length === 0) {
      list.append(el('p', { class: 'empty-line', text: 'No snapshots yet' }));
    }
    for (const snapshot of held) {
      list.append(
        el('div', { role: 'listitem', class: 'snapshot-row' }, [
          el('span', { text: `${snapshot.name} · seq ${num(snapshot.seq)}` }),
          relativeText(el('span', { class: 'snapshot-time' }), snapshot.at),
          ownerButton('Restore', async () => {
            ctx.regions.notice('Restoring…');
            const result = await api.post<ApiFailure>(`/api/snapshots/${snapshot.id}/restore`);
            if (!result.ok) {
              ctx.regions.alert(refusalText(result));
              ctx.regions.notice('');
              return;
            }
            ctx.regions.notice(`Restored ${snapshot.name}`);
            await ctx.reload();
            await load();
          }),
        ]),
      );
    }
    const options = held.map((snapshot) => ({ value: String(snapshot.id), label: snapshot.name }));
    for (const select of [fromSelect, toSelect]) {
      const current = select.value;
      clear(select);
      for (const option of options) {
        select.append(el('option', { value: option.value }, [option.label]));
      }
      if (options.some((option) => option.value === current)) select.value = current;
    }
  };

  const body = el('div', { class: 'panel-body' }, [
    el('div', { class: 'owner-only panel-controls' }, [
    field('Snapshot name', nameInput),
    button('Save snapshot', async () => {
      ctx.regions.notice('Saving snapshot…');
      const result = await api.post<ApiFailure & { name: string }>(
        `/api/sprites/${ctx.model.spriteId}/snapshots`,
        { name: nameInput.value.trim() },
      );
      if (!result.ok) {
        ctx.regions.alert(refusalText(result));
        ctx.regions.notice('');
        return;
      }
      ctx.regions.notice(`Snapshot ${result.body.name} saved`);
      nameInput.value = '';
      await load();
    }),
    ]),
    list,
    field('From', fromSelect),
    field('To', toSelect),
    changes,
  ]);

  void load();

  return {
    node: el('section', { role: 'region', 'aria-label': 'Snapshots', class: 'panel panel-white' }, [
      el('h2', { class: 'panel-title', text: 'Snapshots' }),
      body,
    ]),
    refresh: () => void load(),
  };
}

/** The Activity panel: stable pages of published sentences. */
export function activityPanel(ctx: Workspace): Panel {
  const list = el('div', { role: 'list', 'aria-label': 'Activity', class: 'activity-list' });
  const loadMore = button('Load more', () => void page(cursor));
  let cursor: string | null = null;
  let items: { id: number; sentence: string; at: string }[] = [];

  const draw = (): void => {
    clear(list);
    if (items.length === 0) {
      list.append(el('p', { class: 'empty-line', text: 'No activity yet' }));
    }
    for (const item of items) {
      list.append(
        el('div', { role: 'listitem', class: 'activity-row' }, [
          el('span', { text: item.sentence }),
          relativeText(el('span', { class: 'activity-time' }), item.at),
        ]),
      );
    }
    loadMore.hidden = cursor === null;
  };

  const page = async (from: string | null): Promise<void> => {
    const query = from === null ? '' : `?cursor=${encodeURIComponent(from)}`;
    const result = await api.get<{
      items: { id: number; sentence: string; at: string }[];
      next_cursor: string | null;
    }>(`/api/projects/${ctx.model.projectId}/activity${query}`);
    if (!result.ok) return;
    items = from === null ? result.body.items : [...items, ...result.body.items];
    cursor = result.body.next_cursor;
    draw();
  };

  const body = el('div', { class: 'panel-body' }, [list, loadMore]);
  void page(null);

  return {
    node: el('section', { role: 'region', 'aria-label': 'Activity', class: 'panel panel-white' }, [
      el('h2', { class: 'panel-title', text: 'Activity' }),
      body,
    ]),
    refresh: () => void page(null),
  };
}
