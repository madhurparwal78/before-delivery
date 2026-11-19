import { api, OUTAGE_TEXT } from '../api.js';
import { clear, el, focusHeading } from '../dom.js';
import { heading, showAlert } from '../shell.js';
import { button, field, select, statusRegion, textArea } from '../widgets.js';
import type { AssetDetail, AssetSummary, Measures, UploadResult, VersionView } from '../types.js';
import type { PageContext } from '../main.js';

const MEASURE_ROWS: Array<{ label: string; key: keyof Measures }> = [
  { label: 'triangles', key: 'triangles' },
  { label: 'materials', key: 'materials' },
  { label: 'texture size', key: 'textureSize' },
  { label: 'file size', key: 'fileSize' }
];

const SAMPLE_LAYOUT =
  '{"width":12,"height":12,"spawn":[{"x":1,"y":1}],"walls":[{"x":3,"y":3}],"seats":[{"id":"seat-1","x":5,"y":2}],"exits":[{"id":"exit-1","x":0,"y":6}]}';

export async function renderStudio(ctx: PageContext): Promise<void> {
  heading(ctx.main, 'Studio');
  const kind = select('Kind', [
    { label: 'room', value: 'room' },
    { label: 'avatar', value: 'avatar' }
  ]);
  const name = field('Model name', 'text');
  const file = field('Model file', 'file', { accept: '.glb,model/gltf-binary' });
  const layout = textArea('Room layout');
  layout.input.value = SAMPLE_LAYOUT;
  const upload = button('Upload model', 'primary');
  const uploadResult = statusRegion('Upload result');
  const measureBody = el('tbody', {});
  const measureTable = el('table', { 'aria-label': 'Measures', class: 'grid' }, [
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Measure' }), el('th', { text: 'Value' }), el('th', { text: 'Rank' })])
    ]),
    measureBody
  ]);
  const assetList = el('ul', { 'aria-label': 'Assets', class: 'rows' });
  const versionList = el('ul', { 'aria-label': 'Versions', class: 'rows' });
  const versionResult = statusRegion('Version result');

  kind.input.addEventListener('change', () => {
    layout.wrap.hidden = kind.input.value !== 'room';
  });

  ctx.main.append(
    el('section', { class: 'panel' }, [
      el('h2', { text: 'Upload a model' }),
      kind.wrap,
      name.wrap,
      file.wrap,
      layout.wrap,
      upload,
      uploadResult
    ]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Measures' }), el('div', { class: 'table-wrap' }, [measureTable])]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Your models' }), assetList]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Versions' }), versionList, versionResult])
  );

  const drawMeasures = (measures: Measures, ranks: Record<string, string>): void => {
    clear(measureBody);
    for (const row of MEASURE_ROWS) {
      measureBody.append(
        el('tr', {}, [
          el('td', { text: row.label }),
          el('td', { text: String(measures[row.key]) }),
          el('td', { text: ranks[row.key] ?? '' })
        ])
      );
    }
  };

  let selectedAssetId: string | null = null;

  async function drawVersions(): Promise<void> {
    clear(versionList);
    if (selectedAssetId === null) return;
    const response = await api.get<AssetDetail>(`/api/assets/${selectedAssetId}`);
    if (!response.ok || response.data === null) return;
    for (const version of response.data.versions) {
      versionList.append(versionItem(selectedAssetId, version));
    }
  }

  function versionItem(assetId: string, version: VersionView): HTMLElement {
    const item = el('li', { 'data-version': String(version.version), 'data-version-status': version.status }, [
      el('span', { text: `Version ${version.version} \u2014 ${version.status} \u2014 ${version.rank}` })
    ]);
    if (version.status === 'checked') {
      const publish = button('Publish version', 'primary');
      publish.addEventListener('click', () => {
        versionResult.textContent = 'Saving...';
        void api
          .post(`/api/assets/${assetId}/versions/${version.version}/publish`)
          .then(async (response) => {
            versionResult.textContent = response.ok
              ? `Version ${version.version} published.`
              : (response.error ?? '');
            await drawVersions();
            if (!item.isConnected) focusHeading();
          });
      });
      item.append(publish);
    }
    const restore = button(`Restore version ${version.version}`);
    restore.addEventListener('click', () => {
      versionResult.textContent = 'Saving...';
      void api
        .post<UploadResult>(`/api/assets/${assetId}/versions/${version.version}/restore`)
        .then(async (response) => {
          if (response.ok && response.data !== null) {
            versionResult.textContent = `Version ${version.version} restored as version ${response.data.version}.`;
          } else if (response.status === 503) {
            versionResult.textContent = '';
            showAlert(response.error ?? OUTAGE_TEXT.storageWrite);
          } else {
            versionResult.textContent = response.error ?? '';
          }
          await drawVersions();
        });
    });
    const remove = button(`Remove version ${version.version}`, 'danger');
    remove.addEventListener('click', () => {
      versionResult.textContent = 'Saving...';
      void api.remove(`/api/assets/${assetId}/versions/${version.version}`).then(async (response) => {
        if (response.ok) versionResult.textContent = `Version ${version.version} removed.`;
        else if (response.status === 503) {
          versionResult.textContent = '';
          showAlert(response.error ?? OUTAGE_TEXT.storageWrite);
        } else versionResult.textContent = response.error ?? '';
        await drawAssets();
        await drawVersions();
        if (!item.isConnected) focusHeading();
      });
    });
    item.append(restore, remove);
    return item;
  }

  async function drawAssets(): Promise<void> {
    const response = await api.get<{ assets: AssetSummary[] }>('/api/assets?mine=true');
    clear(assetList);
    for (const asset of response.data?.assets ?? []) {
      const choose = button(`Show versions of ${asset.name}`);
      choose.addEventListener('click', () => {
        selectedAssetId = asset.id;
        void drawVersions();
      });
      assetList.append(
        el('li', { 'data-asset-id': asset.id, 'data-kind': asset.kind }, [
          el('span', {
            text: `${asset.name} \u2014 ${asset.kind} \u2014 ${asset.rank ?? 'unpublished'}`
          }),
          choose
        ])
      );
    }
  }

  upload.addEventListener('click', () => {
    uploadResult.textContent = 'Checking your file...';
    const body = new FormData();
    body.set('kind', kind.input.value);
    body.set('name', name.input.value);
    const chosen = file.input.files?.[0];
    if (chosen !== undefined) body.set('file', chosen, chosen.name);
    if (kind.input.value === 'room') body.set('layout', layout.input.value);
    void api.post<UploadResult>('/api/assets', body).then(async (response) => {
      if (response.ok && response.data !== null) {
        uploadResult.textContent = `Rank: ${response.data.rank}. Worst measure: ${response.data.worstMeasure}.`;
        drawMeasures(response.data.measures, response.data.measureRanks);
        selectedAssetId = response.data.assetId;
        await drawAssets();
        await drawVersions();
        return;
      }
      if (response.status === 503) {
        uploadResult.textContent = '';
        showAlert(response.error ?? OUTAGE_TEXT.storageWrite);
        return;
      }
      uploadResult.textContent = response.error ?? '';
    });
  });

  await drawAssets();
}
