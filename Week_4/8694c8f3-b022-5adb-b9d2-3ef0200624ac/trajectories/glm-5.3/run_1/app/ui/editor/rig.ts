import { el, clear, announce } from '../dom.js';
import { api } from '../api.js';
import type { AssetDoc, ShowVersion, ActivityEntry, PresenceMember } from '../api.js';
import { openDialogWith, closeActiveDialog } from '../dialogs.js';
import { layerOf, type EditorContext } from './context.js';

export interface RigPanels {
  panel: HTMLElement;
  layersPane: HTMLElement;
  assetsPane: HTMLElement;
  showsPane: HTMLElement;
  activityPane: HTMLElement;
}

export function buildRigPanel (ctx: EditorContext): RigPanels {
  const panel = el('aside', { class: 'rig-panel', role: 'complementary', 'aria-label': 'Rig panel' });
  const title = el('div', { class: 'rig-title', text: 'Layers' });
  const search = el('div', { class: 'rig-search' }, el('input', { type: 'text', 'aria-label': 'Search', placeholder: 'Search' }) as unknown as HTMLInputElement);
  const layersPane = el('div', { class: 'rig-pane' });
  const assetsPane = el('div', { class: 'rig-pane' });
  const showsPane = el('div', { class: 'rig-pane' });
  const activityPane = el('div', { class: 'rig-pane' });
  const body = el('div', { class: 'rig-body' }, layersPane, assetsPane, showsPane, activityPane);
  panel.append(title, search, body);
  const titles: Record<string, string> = { layers: 'Layers', assets: 'Assets', shows: 'Shows', activity: 'Activity' };
  const panes: Record<string, HTMLElement> = { layers: layersPane, assets: assetsPane, shows: showsPane, activity: activityPane };
  const renderPane = (choice: string): void => {
    const pane = panes[choice] ?? layersPane;
    if (choice !== 'layers') clear(pane);
    if (choice === 'assets') renderAssets(ctx, pane);
    else if (choice === 'shows') renderShows(ctx, pane);
    else if (choice === 'activity') renderActivity(ctx, pane);
  };
  // Presence changes refresh the shows pane; the layers pane keeps its tree
  // and inspector mounted.
  ctx.rebuildPresence = (members) => {
    ctx.presence = members;
    if (ctx.dockChoice === 'shows') renderPane('shows');
  };
  const shown: Record<string, boolean> = { layers: true, assets: false, shows: false, activity: false };
  ctx.rebuildRigPanel = (): void => {
    title.textContent = titles[ctx.dockChoice] ?? 'Layers';
    for (const [choice, pane] of Object.entries(panes)) {
      const visible = choice === ctx.dockChoice;
      pane.style.display = visible ? '' : 'none';
      if (visible && !shown[choice]) {
        shown[choice] = true;
        renderPane(choice);
      }
    }
  };
  ctx.rebuildRigPanel();
  return { panel, layersPane, assetsPane, showsPane, activityPane };
}

export async function refreshAssets (ctx: EditorContext): Promise<void> {
  const result = await api.get<{ assets: AssetDoc[] }>(`/api/sets/${ctx.setId}/assets`);
  if (!result.ok) return;
  ctx.currentAssets = result.body.assets;
  if (ctx.dockChoice === 'assets') ctx.rebuildRigPanel();
  ctx.rebuildInspector();
}

function renderAssets (ctx: EditorContext, body: HTMLElement): void {
  const upload = el('button', { class: 'row-button primary', text: 'Upload asset' });
  const fileInput = el('input', { type: 'file', class: 'visually-hidden', 'aria-label': 'Choose GLB or texture file', accept: '.glb,.png,.jpg,.jpeg' }) as unknown as HTMLInputElement;
  fileInput.addEventListener('change', () => { void uploadAsset(ctx, fileInput); });
  upload.addEventListener('click', () => fileInput.click());
  const shelf = el('div', { role: 'list', 'aria-label': 'Asset shelf' });
  if (ctx.currentAssets.length === 0) shelf.append(el('div', { class: 'empty-state', text: 'No assets yet' }));
  for (const asset of ctx.currentAssets) {
    const row = el('div', { class: 'asset-row', role: 'listitem' });
    row.append(el('span', { text: asset.name }));
    row.append(el('span', { class: `status${asset.status === 'upload failed' ? ' failed' : ''}`, text: asset.status }));
    row.append(el('span', { class: 'deps', text: `${asset.dependents.count} dependents` }));
    row.append(el('button', {
      class: 'row-button danger', text: `Delete ${asset.name}`,
      click: async () => {
        const result = await api.del(`/api/sets/${ctx.setId}/assets/${asset.id}`);
        if (result.ok) {
          await refreshAssets(ctx);
          return;
        }
        if (result.error.body.code === 'asset_in_use' || result.error.body.code === 'asset_in_shows') {
          openAssetInUseDialog(asset, result.error.body);
        }
      },
    }));
    shelf.append(row);
  }
  body.append(upload, fileInput, shelf);
}

async function uploadAsset (ctx: EditorContext, input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  if (file === undefined) return;
  const kind = file.name.toLowerCase().endsWith('.glb') ? 'model' : 'texture';
  announce(ctx.regions['Asset upload'], `Uploading ${file.name}`);
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const result = await api.upload(`/api/sets/${ctx.setId}/assets`, form);
  if (result.ok) {
    announce(ctx.regions['Asset upload'], `${file.name} is ready`);
  } else {
    announce(ctx.regions['Asset upload'], `${file.name} upload failed`);
    if (result.error.body.code === 'storage_unavailable') {
      ctx.storageDown = true;
      ctx.rebuildBanners();
    }
  }
  input.value = '';
  await refreshAssets(ctx);
}

function openAssetInUseDialog (asset: AssetDoc, body: { dependents?: AssetDoc['dependents']; show_versions?: number[] }): void {
  const content = el('div', {});
  if (body.show_versions !== undefined) {
    content.append(el('div', { text: `${asset.name} is part of published show versions ${body.show_versions.join(', ')}.` }));
  } else {
    content.append(el('div', { text: `${asset.name} is used by:` }));
    const deps = body.dependents;
    if (deps !== undefined) {
      if (deps.layers.length > 0) content.append(el('div', { text: 'Layers' }, el('div', { text: deps.layers.map((l) => l.name).join(', ') })));
      if (deps.materials.length > 0) content.append(el('div', { text: 'Materials' }, el('div', { text: deps.materials.map((l) => l.name).join(', ') })));
      if (deps.scripts.length > 0) content.append(el('div', { text: 'Scripts' }, el('div', { text: deps.scripts.map((s) => s.name).join(', ') })));
    }
  }
  openDialogWith({
    title: 'Asset still in use',
    body: content,
    alert: true,
    dim: true,
    actions: [{ label: 'OK', primary: true, onClick: (close) => close() }],
  });
}

export function renderShows (ctx: EditorContext, body: HTMLElement): void {
  void api.get<{ show_url: string; live_number: number | null; versions: ShowVersion[] }>(`/api/sets/${ctx.setId}/shows`).then((result) => {
    if (!result.ok) return;
    clear(body);
    const list = el('div', { role: 'list', 'aria-label': 'Show versions' });
    if (result.body.versions.length === 0) list.append(el('div', { class: 'empty-state', text: 'No show versions yet' }));
    const live = result.body.live_number;
    for (const version of result.body.versions) {
      const row = el('div', { class: 'show-row', role: 'listitem' });
      row.append(el('span', { text: `Version ${version.number}` }));
      if (version.number === live) row.append(el('span', { class: 'live-tag', text: 'live' }));
      if (version.status !== 'published') row.append(el('span', { text: version.status }));
      if (version.number !== live && version.status === 'published') {
        row.append(el('button', {
          class: 'row-button', text: `Make version ${version.number} live`,
          click: async () => {
            const activate = await api.post<{ live_number: number }>(`/api/sets/${ctx.setId}/shows/${version.number}/activate`);
            if (activate.ok) {
              announce(ctx.regions['Show status'], `Version ${version.number} is live`);
              ctx.rebuildRigPanel();
            }
          },
        }));
      }
      list.append(row);
    }
    const publish = el('button', { class: 'row-button primary', text: 'Publish show', click: () => { void publishShow(ctx); } });
    const rollback = el('button', { class: 'row-button', text: 'Roll back', click: async () => {
      const result2 = await api.post<{ live_number: number }>(`/api/sets/${ctx.setId}/shows/rollback`);
      if (result2.ok) {
        announce(ctx.regions['Show status'], `Rolled back. Version ${result2.body.live_number} is live`);
        ctx.rebuildRigPanel();
      }
    } });
    const link = el('a', { href: result.body.show_url, text: 'Show link' });
    const copy = el('button', { class: 'row-button', text: 'Copy show link', click: () => { void navigator.clipboard.writeText(window.location.origin + result.body.show_url); } });
    const exportButton = el('button', { class: 'row-button', text: 'Export set', click: () => { void exportSet(ctx); } });
    list.append(publish, rollback, link, copy, exportButton);
    body.append(list);
    const inviteButton = el('button', { class: 'row-button', text: 'Invite guest VJ', click: () => openInviteDialog(ctx) });
    body.append(inviteButton);
    body.append(el('h3', { text: 'In this set' }));
    const presence = el('ul', { role: 'list', 'aria-label': 'In this set', style: 'list-style:none; padding:0;' });
    body.append(presence);
    rebuildPresence(ctx, presence, ctx.presence);
    // The current members load with the panel, not only from live events.
    void api.get<{ members: PresenceMember[] }>(`/api/sets/${ctx.setId}/presence`).then((result) => {
      if (!result.ok) return;
      ctx.presence = result.body.members;
      rebuildPresence(ctx, presence, ctx.presence);
    }).catch(() => {});
  });
}

function rebuildPresence (ctx: EditorContext, list: HTMLElement, members: { user_id: string; display_name: string; colour: string; selection: string | null }[]): void {
  clear(list);
  for (const member of members) {
    const row = el('li', { class: 'presence-row' });
    row.append(el('span', { text: member.display_name }));
    const dot = el('span', { class: 'presence-dot', role: 'img', 'aria-label': `Cursor colour ${member.colour}` });
    dot.style.background = member.colour;
    row.append(dot);
    const layer = layerOf(ctx, member.selection);
    row.append(el('span', { text: layer !== null ? layer.name : 'nothing selected' }));
    list.append(row);
  }
}

async function publishShow (ctx: EditorContext): Promise<void> {
  announce(ctx.regions['Show status'], 'Publishing');
  const result = await api.post<{ show_version: { number: number } }>(`/api/sets/${ctx.setId}/shows`, {});
  if (!result.ok) {
    if (result.error.body.code === 'storage_unavailable') {
      ctx.storageDown = true;
      ctx.rebuildBanners();
    }
    announce(ctx.regions['Show status'], result.error.body.message);
    return;
  }
  announce(ctx.regions['Show status'], `Version ${result.body.show_version.number} is live`);
  ctx.rebuildRigPanel();
}

async function exportSet (ctx: EditorContext): Promise<void> {
  announce(ctx.regions['Export status'], 'Preparing export');
  const result = await api.post<{ export: { sha256: string; download_url: string } }>(`/api/sets/${ctx.setId}/exports`, {});
  if (!result.ok) {
    if (result.error.body.code === 'storage_unavailable') {
      ctx.storageDown = true;
      ctx.rebuildBanners();
    }
    return;
  }
  announce(ctx.regions['Export status'], 'Export ready');
  const anchor = el('a', { href: result.body.export.download_url, download: 'export.afterglass.zip', text: '' });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function openInviteDialog (ctx: EditorContext): void {
  const editor = el('input', { type: 'radio', name: 'invite-role', value: 'editor', 'aria-label': 'Editor' }) as unknown as HTMLInputElement;
  editor.checked = true;
  const viewer = el('input', { type: 'radio', name: 'invite-role', value: 'viewer', 'aria-label': 'Viewer' }) as unknown as HTMLInputElement;
  const linkInput = el('input', { type: 'text', readonly: true, 'aria-label': 'Invite link' }) as unknown as HTMLInputElement;
  const form = el('form', {},
    el('div', { class: 'radio-row' }, editor, el('label', { text: 'Editor' })),
    el('div', { class: 'radio-row' }, viewer, el('label', { text: 'Viewer' })),
    el('div', {}, el('label', { text: 'Invite link' }), linkInput),
    el('div', { class: 'dialog-actions' },
      el('button', { type: 'button', class: 'row-button primary', text: 'Create link', click: async () => {
        const role = viewer.checked ? 'viewer' : 'editor';
        const result = await api.post<{ url: string }>(`/api/sets/${ctx.setId}/invites`, { role });
        if (result.ok) linkInput.value = window.location.origin + result.body.url;
      } }),
      el('button', { type: 'button', class: 'row-button', text: 'Copy link', click: () => { void navigator.clipboard.writeText(linkInput.value); } }),
      el('button', { type: 'button', class: 'row-button', text: 'Done', click: () => closeActiveDialog() }),
    ));
  openDialogWith({ title: 'Invite to this set', form });
}

function renderActivity (ctx: EditorContext, body: HTMLElement): void {
  const list = el('div', { role: 'list', 'aria-label': 'Activity' });
  body.append(list);
  void api.get<{ entries: ActivityEntry[] }>(`/api/sets/${ctx.setId}/activity`).then((result) => {
    if (!result.ok) return;
    clear(list);
    if (result.body.entries.length === 0) list.append(el('div', { class: 'empty-state', text: 'No activity yet' }));
    for (const entry of result.body.entries) {
      list.append(el('div', { class: 'activity-row', role: 'listitem', text: `${entry.actor.display_name} — ${entry.summary}` }));
    }
  });
}
