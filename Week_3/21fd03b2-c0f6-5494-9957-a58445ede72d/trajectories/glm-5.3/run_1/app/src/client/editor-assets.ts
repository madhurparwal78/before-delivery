import { api } from './api';
import { h, chip, focusTrap } from './ui';
import { COPY } from '../bench/copy';
import { KIND_SPECS, type SceneDocument, type SceneObject } from '../bench/scene';
import type { Op } from '../bench/ops';
import type { EditorState } from './editor';
import type { AssetData, CheckpointData } from './editor-util';

// Assets panel (files and checkpoints), publish and share dialogs.

export function drawAssets(ed: EditorState): void {
  const body = ed.panelBody('Assets');
  body.replaceChildren();
  const tabs = h('div', { class: 'tab-row', role: 'tablist', 'aria-label': 'Asset views' });
  const content = h('div', {});
  let active = 'files';
  const filesTab = h('button', { role: 'tab', 'aria-selected': 'true' }, 'Files');
  const checkpointsTab = h('button', { role: 'tab', 'aria-selected': 'false' }, 'Checkpoints');
  const render = (): void => {
    content.replaceChildren();
    if (active === 'files') renderAssetFiles(ed, content);
    else renderCheckpoints(ed, content);
  };
  filesTab.addEventListener('click', () => { active = 'files'; filesTab.setAttribute('aria-selected', 'true'); checkpointsTab.setAttribute('aria-selected', 'false'); render(); });
  checkpointsTab.addEventListener('click', () => { active = 'checkpoints'; checkpointsTab.setAttribute('aria-selected', 'true'); filesTab.setAttribute('aria-selected', 'false'); render(); });
  tabs.append(filesTab, checkpointsTab);
  body.append(tabs, content);
  render();
}

function renderAssetFiles(ed: EditorState, host: HTMLElement): void {
  let folder = 'Models';
  const folders = h('div', { role: 'tree', 'aria-label': 'Folders', style: { display: 'flex', gap: '10px', margin: '4px 0' } });
  const modelsItem = h('div', { role: 'treeitem', 'aria-selected': 'true', style: { cursor: 'pointer' } }, 'Models');
  const imagesItem = h('div', { role: 'treeitem', 'aria-selected': 'false', style: { cursor: 'pointer' } }, 'Images');
  folders.append(modelsItem, imagesItem);
  const contents = h('div', { role: 'list', 'aria-label': 'Folder contents' });
  const filter = h('input', { type: 'search', 'aria-label': 'Filter assets', placeholder: 'Filter', style: { minWidth: '0', width: '90px' } }) as HTMLInputElement;
  const unitSelect = h('select', { 'aria-label': 'Model units' }) as HTMLSelectElement;
  for (const unit of ['m', 'cm', 'mm', 'in', 'ft']) {
    const opt = document.createElement('option');
    opt.value = unit;
    opt.textContent = unit;
    unitSelect.append(opt);
  }
  const fileInput = h('input', { type: 'file', style: { display: 'none' } }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void ed.uploadAsset(file, unitSelect.value);
    fileInput.value = '';
  });
  const uploadBtn = chip('Upload', { onClick: () => fileInput.click() });
  const breadcrumb = h('span', { class: 'muted', style: { fontSize: '11.5px' } }, `Assets / ${folder}`);
  const thumbSize = h('input', { type: 'range', 'aria-label': 'Thumbnail size', min: '48', max: '120', value: '72' }) as HTMLInputElement;
  const listToggle = chip('List view', { pressed: true });
  host.addEventListener('dragover', (e) => e.preventDefault());
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = (e as DragEvent).dataTransfer?.files[0];
    if (file) void ed.uploadAsset(file, unitSelect.value);
  });

  const renderContents = async (): Promise<void> => {
    breadcrumb.textContent = `Assets / ${folder}`;
    contents.replaceChildren();
    if (!ed.scene) return;
    const result = await api('GET', `/api/projects/${ed.scene.projectId}`);
    if (!result.ok) return;
    const data = result.body as { assets: AssetData[] };
    const items = data.assets.filter((a) => (folder === 'Models' ? a.kind === 'glb' || a.kind === 'gltf' : a.kind === 'png' || a.kind === 'jpeg'));
    const filtered = items.filter((a) => a.name.toLowerCase().includes(filter.value.trim().toLowerCase()));
    if (filtered.length === 0) {
      contents.append(h('div', { class: 'empty-state' }, COPY.empty.folder));
      return;
    }
    for (const asset of filtered) {
      const row = h('div', { role: 'listitem', class: 'row', style: { justifyContent: 'space-between' } },
        h('span', {}, asset.name));
      if (asset.extentMetres !== null) {
        row.append(h('span', { class: 'muted' }, `${asset.extentMetres.toFixed(2)} m`));
      }
      contents.append(row);
    }
  };
  modelsItem.addEventListener('click', () => { folder = 'Models'; modelsItem.setAttribute('aria-selected', 'true'); imagesItem.setAttribute('aria-selected', 'false'); void renderContents(); });
  imagesItem.addEventListener('click', () => { folder = 'Images'; imagesItem.setAttribute('aria-selected', 'true'); modelsItem.setAttribute('aria-selected', 'false'); void renderContents(); });
  filter.addEventListener('input', () => void renderContents());
  host.append(h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, uploadBtn, unitSelect, filter, fileInput));
  host.append(folders, contents);
  host.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' } }, breadcrumb, thumbSize, listToggle));
  void renderContents();
}

function renderCheckpoints(ed: EditorState, host: HTMLElement): void {
  const nameInput = h('input', { type: 'text', 'aria-label': 'Checkpoint name', style: { display: 'none', minWidth: '0' } }) as HTMLInputElement;
  const saveBtn = chip('Save checkpoint', { onClick: async () => {
    if (!nameInput.value.trim()) return;
    ed.setNotice(COPY.notices.checkpointSaving);
    const result = await api('POST', `/api/scenes/${ed.route.sid}/checkpoints`, { label: nameInput.value });
    if (result.ok) {
      ed.setNotice(COPY.notices.checkpointSaved(nameInput.value));
      nameInput.value = '';
      nameInput.style.display = 'none';
      saveBtn.style.display = 'none';
      void renderCheckpointsInner(ed, list);
    } else {
      ed.setNotice(result.error.fields?.label ?? result.error.message);
    }
  } });
  saveBtn.style.display = 'none';
  const list = h('div', {});
  host.append(
    chip('New checkpoint', { onClick: () => {
      nameInput.style.display = '';
      saveBtn.style.display = '';
      nameInput.focus();
    } }),
    h('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, nameInput, saveBtn),
    list,
  );
  void renderCheckpointsInner(ed, list);
}

async function renderCheckpointsInner(ed: EditorState, list: HTMLElement): Promise<void> {
  list.replaceChildren(h('div', { class: 'loading-state' }, COPY.loading));
  const result = await api('GET', `/api/scenes/${ed.route.sid}/checkpoints`);
  if (!result.ok) return;
  const data = result.body as { checkpoints: CheckpointData[] };
  list.replaceChildren();
  if (data.checkpoints.length === 0) {
    list.append(h('div', { class: 'empty-state' }, COPY.empty.checkpoints));
    return;
  }
  for (const cp of data.checkpoints) {
    list.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', {}, cp.label),
      chip(`Restore ${cp.label}`, { onClick: () => confirmRestore(ed, cp) })));
  }
}

function confirmRestore(ed: EditorState, cp: CheckpointData): void {
  const opener = document.activeElement as HTMLElement | null;
  const backdrop = h('div', { class: 'dialog-backdrop' });
  const dialog = h('div', { class: 'dialog', role: 'alertdialog', 'aria-label': 'Restore checkpoint' },
    h('h2', {}, 'Restore checkpoint'),
    h('p', {}, `Restore ${cp.label}? The scene returns to this checkpoint.`),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'chip', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'chip', onclick: async () => {
        const result = await api('POST', `/api/scenes/${ed.route.sid}/checkpoints/${cp.id}/restore`, {});
        close();
        if (result.ok) {
          const body = result.body as { revision: number; stateHash: string };
          ed.baseRevision = body.revision;
          ed.setSaveStatus(COPY.saveStatus.restoreDone(cp.label));
          await ed.reloadDocument();
        } else if (result.error.status === 409) {
          ed.setSaveStatus(COPY.saveStatus.restoreRefused);
        } else if (result.error.status === 503) {
          ed.setNotice(COPY.upload.outage);
        }
      } }, 'Restore'),
    ),
  );
  const close = (): void => {
    backdrop.remove();
    opener?.focus();
  };
  backdrop.append(dialog);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  focusTrap(dialog, close);
  (dialog.querySelector('button') as HTMLButtonElement).focus();
}

export function openPublish(ed: EditorState): void {
  if (ed.role !== 'owner') return;
  const backdrop = h('div', { class: 'dialog-backdrop' });
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Publish lab' });
  const close = (): void => { backdrop.remove(); opener?.focus(); };
  const opener = document.activeElement as HTMLElement | null;
  const build = async (): Promise<void> => {
    dialog.replaceChildren(h('h2', {}, 'Publish lab'));
    const cpsResult = await api('GET', `/api/scenes/${ed.route.sid}/checkpoints`);
    if (!cpsResult.ok) { dialog.append(h('p', {}, 'Could not load checkpoints.')); return; }
    const cps = (cpsResult.body as { checkpoints: CheckpointData[] }).checkpoints;
    const checkpointSelect = h('select', { 'aria-label': 'Checkpoint' }) as HTMLSelectElement;
    if (cps.length === 0) checkpointSelect.disabled = true;
    for (const cp of cps) {
      const opt = document.createElement('option');
      opt.value = cp.id;
      opt.textContent = cp.label;
      checkpointSelect.append(opt);
    }
    dialog.append(h('div', { class: 'field-line' }, h('span', { class: 'field-label' }, 'Checkpoint'), checkpointSelect));
    const checkboxes: HTMLInputElement[] = [];
    for (const object of ed.doc?.objects ?? []) {
      for (const spec of KIND_SPECS[object.kind].params) {
        const id = `exp-${object.id}-${spec.key}`;
        const input = h('input', { type: 'checkbox', id }) as HTMLInputElement;
        const label = h('label', { for: id, style: { display: 'block', padding: '2px 0' } }, input, ` ${object.name}: ${spec.label}`);
        checkboxes.push(input);
        dialog.append(label);
      }
    }
    const publishBtn = h('button', { class: 'chip', onclick: async () => {
      const exposed = checkboxes.filter((c) => c.checked).map((c) => c.id.replace('exp-', '').replace(/-([a-z_]+)$/, '.$1'));
      ed.setNotice(COPY.notices.publishPending);
      const result = await api('POST', `/api/scenes/${ed.route.sid}/publish`, { checkpointId: checkpointSelect.value, exposed });
      if (!result.ok) {
        if (result.error.code === 'no_checkpoint') ed.setNotice(COPY.notices.publishNoCheckpoint);
        else ed.setNotice(result.error.fields?.exposed ?? result.error.message);
        return;
      }
      const body = result.body as { lab: { token: string; url: string; bundleHash: string }; delivery: string };
      const address = body.lab.url;
      ed.setNotice(body.delivery === 'sent' ? COPY.notices.publishSent(address) : COPY.notices.publishQueued(address));
      await buildPublished(body.lab, address);
    } }, 'Publish lab');
    dialog.append(h('div', { class: 'dialog-actions' }, publishBtn, h('button', { class: 'chip', onclick: () => close() }, 'Close')));
    const lab = ed.scene?.lab;
    if (lab) {
      const cps2 = cps;
      if (cps2.length > 0) checkpointSelect.value = lab.checkpointId;
      for (const input of checkboxes) {
        const key = input.id.replace('exp-', '').replace(/-([a-z_]+)$/, '.$1');
        input.checked = lab.exposed.includes(key);
      }
      await buildPublished({ token: lab.token, url: lab.url, bundleHash: lab.bundleHash }, lab.url);
    }
  };
  const buildPublished = async (lab: { token: string; url: string; bundleHash: string }, address: string): Promise<void> => {
    let host = dialog.querySelector('[data-published]') as HTMLElement | null;
    if (!host) {
      host = h('div', { 'data-published': '1', style: { marginTop: '10px' } });
      dialog.append(host);
    }
    host.replaceChildren(
      h('p', { style: { wordBreak: 'break-all' } }, address),
      h('div', { class: 'dialog-actions' },
        chip('Copy lab link', { onClick: () => { void navigator.clipboard?.writeText(address); ed.setNotice(COPY.notices.copied); } }),
        chip('Regenerate lab link', { onClick: async () => {
          const result = await api('POST', `/api/scenes/${ed.route.sid}/lab-link/regenerate`, {});
          if (result.ok) {
            const newLab = (result.body as { lab: { token: string; url: string; bundleHash: string } }).lab;
            ed.setNotice(COPY.notices.labRegenerated);
            await buildPublished(newLab, newLab.url);
          }
        } }),
        chip('Unpublish', { onClick: async () => {
          const result = await api('POST', `/api/scenes/${ed.route.sid}/unpublish`, {});
          if (result.ok) {
            ed.setNotice(COPY.notices.unpublished);
            host?.replaceChildren();
          }
        } }),
      ),
    );
  };
  backdrop.append(dialog);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  focusTrap(dialog, close);
  void build();
  const first = dialog.querySelector<HTMLElement>('button, select, input');
  first?.focus();
}

export function openShare(ed: EditorState): void {
  if (ed.role !== 'owner' || !ed.scene) return;
  const backdrop = h('div', { class: 'dialog-backdrop' });
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'Share project' });
  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => { backdrop.remove(); opener?.focus(); };
  const linksHost = h('div', {});
  const emailInput = h('input', { type: 'text', 'aria-label': 'Email the link to', placeholder: 'email' }) as HTMLInputElement;
  const loadLinks = async (): Promise<void> => {
    const result = await api('GET', `/api/projects/${ed.scene!.projectId}/share-links`);
    if (!result.ok) return;
    const data = result.body as { links: Array<{ id: string; token: string; url: string; expiresAt: string }> };
    linksHost.replaceChildren();
    const list = h('ul', { role: 'list', 'aria-label': 'Active links', style: { listStyle: 'none', padding: '0', margin: '0' } });
    if (data.links.length === 0) list.append(h('li', { class: 'empty-state' }, COPY.empty.links));
    for (const link of data.links) {
      const li = h('li', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' } },
        h('span', { class: 'muted', style: { fontSize: '11px' } }, `Expires ${new Date(link.expiresAt).toLocaleDateString()}`),
        h('span', { style: { display: 'flex', gap: '4px' } },
          chip('Copy link', { onClick: () => { void navigator.clipboard?.writeText(link.url); ed.setNotice(COPY.notices.copied); } }),
          chip('Regenerate link', { onClick: async () => {
            const result2 = await api('POST', `/api/share-links/${link.id}/regenerate`, {});
            if (result2.ok) { ed.setNotice(COPY.notices.linkRegenerated); void loadLinks(); }
          } }),
          chip('Revoke link', { onClick: async () => {
            const result3 = await api('DELETE', `/api/share-links/${link.id}`);
            if (result3.ok) { ed.setNotice(COPY.notices.linkRevoked); void loadLinks(); }
          } }),
        ),
      );
      list.append(li);
    }
    linksHost.append(list);
  };
  dialog.append(
    h('h2', {}, 'Share project'),
    h('div', { class: 'field-line' }, chip('Create read-only link', { onClick: async () => {
      const result = await api('POST', `/api/projects/${ed.scene!.projectId}/share-links`, {});
      if (result.ok) { ed.setNotice(COPY.notices.linkCreated); void loadLinks(); }
    } })),
    h('div', { class: 'field-line' }, emailInput, chip('Create and email link', { onClick: async () => {
      const result = await api('POST', `/api/projects/${ed.scene!.projectId}/share-links`, { email: emailInput.value });
      if (result.ok) {
        const body = result.body as { delivery: string };
        ed.setNotice(body.delivery === 'sent' ? COPY.notices.linkEmailed(emailInput.value) : COPY.notices.linkEmailedQueued(emailInput.value));
        emailInput.value = '';
        void loadLinks();
      } else {
        ed.setNotice(result.error.fields?.email ?? result.error.message);
      }
    } })),
    linksHost,
    h('div', { class: 'dialog-actions' }, h('button', { class: 'chip', onclick: () => close() }, 'Close')),
  );
  backdrop.append(dialog);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  focusTrap(dialog, close);
  void loadLinks();
  const first = dialog.querySelector<HTMLElement>('button, input');
  first?.focus();
}
