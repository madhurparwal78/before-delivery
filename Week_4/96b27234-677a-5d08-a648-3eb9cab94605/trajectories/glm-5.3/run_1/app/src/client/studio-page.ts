// Studio page: upload by keyboard, the rank, the worst measure, the measures
// table, and the Creator's assets and versions.
import { api, el, type Ctx } from './main';
import { computeRank, RANK_LIMITS, type AssetKind, type Measures, type Rank } from '../shared/glb';
import { parseLayout } from '../shared/grid';

interface VersionInfo {
  version: number;
  status: string;
  rank: string;
  worstMeasure: string;
  measures: Measures;
  createdAt: string;
}

interface AssetInfo {
  id: string;
  kind: string;
  name: string;
  ownerName: string;
  currentVersion: number | null;
  rank: string | null;
  versions: VersionInfo[];
}

export async function renderStudioPage(ctx: Ctx): Promise<void> {
  const main = ctx.main;
  main.append(el('h1', {}, 'Studio'));

  const kind = el('select', { 'aria-label': 'Kind' }) as HTMLSelectElement;
  for (const k of ['room', 'avatar']) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = k;
    kind.append(o);
  }
  const name = el('input', { type: 'text', 'aria-label': 'Model name' }) as HTMLInputElement;
  const file = el('input', { type: 'file', 'aria-label': 'Model file' }) as HTMLInputElement;
  const layout = el('textarea', { 'aria-label': 'Room layout' }) as HTMLTextAreaElement;
  const layoutField = el('label', {}, 'Room layout', layout);
  layoutField.hidden = true;
  kind.addEventListener('change', () => {
    layoutField.hidden = kind.value !== 'room';
  });
  const upload = el('button', { class: 'primary' }, 'Upload model');
  const result = el('div', { role: 'status', 'aria-label': 'Upload result', class: 'status-region' });
  const alert = el('div', { role: 'alert', class: 'status-region' });

  const measuresTable = el('table', { 'aria-label': 'Measures' });
  measuresTable.append(
    el('thead', {}, el('tr', {}, el('th', {}, 'Measure'), el('th', {}, 'Value'), el('th', {}, 'Rank')))
  );
  const tbody = el('tbody');
  measuresTable.append(tbody);

  const uploadPanel = el('div', { class: 'panel' }, kind, name, file, layoutField, upload, result, alert);
  main.append(uploadPanel);
  const measuresPanel = el('div', { class: 'panel' }, el('h2', {}, 'Measures'), measuresTable);
  measuresPanel.hidden = true;
  main.append(measuresPanel);

  const renderMeasures = (measures: Measures, k: AssetKind, defaultRank: Rank, defaultWorst: string): void => {
    tbody.textContent = '';
    const labels: [keyof Measures, string][] = [
      ['triangles', 'triangles'],
      ['materials', 'materials'],
      ['textureSize', 'texture size'],
      ['fileSize', 'file size'],
    ];
    const computed = computeRank(k, measures);
    for (const [key, label] of labels) {
      const value = measures[key];
      const rowRank = computed.perMeasure[key];
      tbody.append(el('tr', {}, el('td', {}, label), el('td', {}, String(value)), el('td', {}, rowRank)));
    }
    if (!defaultWorst) {
      void defaultRank;
    }
    measuresPanel.hidden = false;
  };

  upload.addEventListener('click', async () => {
    result.textContent = 'Checking your file...';
    alert.textContent = '';
    const form = new FormData();
    form.set('kind', kind.value);
    form.set('name', name.value);
    if (file.files?.[0]) form.set('file', file.files[0]);
    if (kind.value === 'room') form.set('layout', layout.value);
    try {
      const res = await api<{ assetId: string; version: number; rank: string; worstMeasure: string; measures: Measures }>('/api/assets', {
        method: 'POST',
        body: form,
      });
      result.textContent = `Rank: ${res.rank}. Worst measure: ${res.worstMeasure}.`;
      renderMeasures(res.measures, kind.value as AssetKind, res.rank as Rank, res.worstMeasure);
      await loadAssets();
    } catch (e) {
      const message = (e as Error).message;
      result.textContent = message;
      alert.textContent = message;
    }
  });

  const versionResult = el('div', { role: 'status', 'aria-label': 'Version result', class: 'status-region' });
  const assetsPanel = el('div', { class: 'panel' }, el('h2', {}, 'Your assets'), versionResult);
  main.append(assetsPanel);

  const loadAssets = async (): Promise<void> => {
    const res = await api<{ assets: { id: string; kind: string; name: string; rank: string | null; currentVersion: number | null }[] }>('/api/assets?mine=true');
    assetsPanel.textContent = '';
    assetsPanel.append(el('h2', {}, 'Your assets'), versionResult);
    for (const a of res.assets) {
      const detail = await api<AssetInfo>(`/api/assets/${a.id}`);
      const section = el('section', {}, el('h3', {}, `${a.name} (${a.kind})`));
      const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Versions' });
      for (const v of detail.versions) {
        const item = el('li', { 'data-version': String(v.version), 'data-version-status': v.status }, `Version ${v.version} (${v.status}, ${v.rank})`);
        if (v.status === 'checked') {
          const publish = el('button', { class: 'primary' }, 'Publish version');
          publish.addEventListener('click', async () => {
            versionResult.textContent = 'Saving...';
            try {
              await api(`/api/assets/${a.id}/versions/${v.version}/publish`, { method: 'POST' });
              versionResult.textContent = `Version ${v.version} published.`;
              await loadAssets();
            } catch (e) { versionResult.textContent = (e as Error).message; }
          });
          item.append(' ', publish);
        }
        const restore = el('button', { 'aria-label': `Restore version ${v.version}` }, `Restore version ${v.version}`);
        restore.addEventListener('click', async () => {
          versionResult.textContent = 'Saving...';
          try {
            const res2 = await api<{ version: number }>(`/api/assets/${a.id}/versions/${v.version}/restore`, { method: 'POST' });
            versionResult.textContent = `Version ${v.version} restored as version ${res2.version}.`;
            await loadAssets();
          } catch (e) { versionResult.textContent = (e as Error).message; }
        });
        const remove = el('button', { class: 'danger', 'aria-label': `Remove version ${v.version}` }, `Remove version ${v.version}`);
        remove.addEventListener('click', async () => {
          versionResult.textContent = 'Saving...';
          try {
            await api(`/api/assets/${a.id}/versions/${v.version}`, { method: 'DELETE' });
            versionResult.textContent = `Version ${v.version} removed.`;
            await loadAssets();
          } catch (e) { versionResult.textContent = (e as Error).message; }
        });
        item.append(' ', restore, ' ', remove);
        list.append(item);
      }
      section.append(list);
      assetsPanel.append(section);
    }
    void parseLayout;
    void RANK_LIMITS;
  };
  await loadAssets();
}
