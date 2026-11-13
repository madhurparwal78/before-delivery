import { el, t } from './ui.js';
import { api, getJson, type Weapon, type Character, type Model, type RuleResult, type Report } from './api-client.js';
import { store, notify, loadMe } from './store.js';
import { languagePickerHtml } from './language.js';
import { navTabs, signOutButton } from './pages-hangar.js';
import { formatNumber } from '../shared/domain.js';
import type { Locale } from '../shared/domain.js';
import { locale } from './ui.js';

/**
 * The armoury (DP-23, DP-70) and the models page (DP-24 to DP-30, DP-69).
 */

export async function mountArmoury(): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/armoury'));
  const main = el('section', { class: 'page-main' });
  const list = el('div', { role: 'list', 'aria-label': t('controls', 'armoury-list'), class: 'armoury-list', id: 'armoury-list' });
  const equippedId = store.equippedCharacter?.weapon_id ?? null;

  const render = (weapons: Weapon[]) => {
    list.replaceChildren();
    if (weapons.length === 0) {
      const empty = el('div', { class: 'empty-state', role: 'heading', tabindex: '-1' });
      const heading = el('h2', { text: t('copy', 'empty-armoury-heading') });
      empty.append(heading, el('p', { text: t('copy', 'empty-armoury-text') }));
      list.append(empty);
      return;
    }
    for (const weapon of weapons) {
      const card = el('div', { class: 'weapon-card', role: 'listitem' });
      const title = el('h3', { text: t('copy', 'weapon-name', { n: weapon.number }) });
      const stats = el('p', {
        text: `${t('copy', 'stats-reach', { reach: formatNumber(weapon.stats.reach_m, locale as Locale, 2) })} · ${t('copy', 'stats-weight', { weight: formatNumber(weapon.stats.weight_kg, locale as Locale, 2) })} · ${t('copy', 'stats-swing', { swing: formatNumber(weapon.stats.swing_per_s, locale as Locale, 2) })}`,
      });
      const equip = el('button', { class: 'ghost', text: t('controls', 'equip') });
      const del = el('button', { class: 'ghost', text: t('controls', 'delete') });
      if (weapon.id === equippedId) {
        card.classList.add('equipped');
        equip.disabled = true;
      }
      equip.addEventListener('click', async () => {
        equip.disabled = true;
        equip.textContent = t('copy', 'working');
        const characterId = store.equippedCharacter?.id ?? '';
        const result = await api<{ character: Character }>('POST', `/api/characters/${characterId}/equip`);
        equip.textContent = t('controls', 'equip');
        if (result.status === 200) {
          notify(t('copy', 'model-equipped'));
          await loadMe();
        } else {
          equip.disabled = false;
        }
      });
      del.addEventListener('click', async () => {
        del.disabled = true;
        del.textContent = t('copy', 'working');
        const result = await api('DELETE', `/api/weapons/${weapon.id}`);
        if (result.status === 204) {
          notify(t('copy', 'weapon-deleted'));
          const res = await getJson<{ weapons: Weapon[] }>('/api/weapons');
          render(res?.weapons ?? []);
          await loadMe();
        } else {
          del.disabled = false;
          del.textContent = t('controls', 'delete');
        }
      });
      card.append(title, stats, equip, del);
      list.append(card);
    }
  };

  const res = await getJson<{ weapons: Weapon[] }>('/api/weapons');
  render(res?.weapons ?? []);
  main.append(el('h1', { class: 'screen-heading', text: t('copy', 'armoury-heading') }), list, languagePickerHtml(), signOutButton());
  root.append(layout, main);
}

export async function mountModels(): Promise<void> {
  await loadMe();
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/models'));
  const main = el('section', { class: 'page-main models-main' });

  const banner = el('div', { id: 'storage-banner', class: 'alert-banner', role: 'alert', hidden: true });
  const statusRegion = el('div', { id: 'upload-status', role: 'status', 'aria-live': 'polite', class: 'polite-region', 'aria-label': t('controls', 'upload-status') });
  const upload = el('button', { class: 'primary', text: t('controls', 'upload-model') });
  const fileInput = el('input', { type: 'file', accept: '.glb', class: 'hidden-input', 'aria-label': t('controls', 'model-file') }) as HTMLInputElement;
  const list = el('div', { role: 'list', 'aria-label': t('controls', 'my-models'), class: 'models-list', id: 'models-list' });
  const report = el('section', { role: 'region', 'aria-label': t('controls', 'upload-report'), class: 'upload-report', id: 'upload-report' });

  let selectedModelId: string | null = null;
  let announcedStages = new Set<string>();

  const updateBanner = () => {
    const notice = store.account?.storage_notice ?? null;
    if (notice) {
      banner.hidden = false;
      banner.textContent = t('copy', notice === 'upload_unavailable' ? 'storage-outage-upload' : 'storage-outage-delete');
    } else {
      banner.hidden = true;
    }
  };

  const ruleLine = (rule: RuleResult): string => {
    if (rule.status === 'skipped') return t('report', 'skipped');
    if (rule.id === 'R01') return t('report', 'header');
    if (rule.id === 'R06') {
      return rule.measured === '' || rule.measured === null ? t('report', 'nothing-missing') : t('report', 'missing', { measured: String(rule.measured) });
    }
    if (rule.id === 'R10') {
      if (rule.measured === null) return t('report', 'matrix');
      const parts = rule.measured as [number, number, number, number];
      return t('report', 'rotation', {
        w: formatNumber(parts[3] ?? 0, locale as Locale, 4),
        x: formatNumber(parts[0] ?? 0, locale as Locale, 4),
        y: formatNumber(parts[1] ?? 0, locale as Locale, 4),
        z: formatNumber(parts[2] ?? 0, locale as Locale, 4),
      });
    }
    return t('report', 'measured-limit', { measured: formatNumber(Number(rule.measured ?? 0), locale as Locale), limit: formatNumber(rule.limit ?? 0, locale as Locale) });
  };

  const statusKeys: Record<Model['status'], 'status-stored' | 'status-validating' | 'status-accepted' | 'status-equipped' | 'status-rejected'> = {
    stored: 'status-stored', validating: 'status-validating', accepted: 'status-accepted', equipped: 'status-equipped', rejected: 'status-rejected',
  };
  const statusWord = (status: Model['status']): string => t('copy', statusKeys[status]);

  const renderList = (models: Model[]) => {
    list.replaceChildren();
    for (const model of models) {
      const item = el('div', { class: 'model-item', role: 'listitem' });
      const button = el('button', { class: 'model-name', text: model.filename });
      if (model.id === selectedModelId) {
        button.setAttribute('aria-current', 'true');
        item.classList.add('selected');
      }
      button.addEventListener('click', () => {
        selectedModelId = model.id;
        renderReport(model);
      });
      const status = el('span', { class: `model-status ${model.status}`, text: statusWord(model.status) });
      const thumb = el('img', { src: `/api/models/${model.id}/thumbnail`, alt: model.filename, class: 'model-thumb' });
      thumb.addEventListener('error', () => {
        thumb.remove();
      });
      item.append(thumb, button, status);
      list.append(item);
    }
  };

  const reportHeading = (model: Model): string => {
    if (model.status === 'validating' || model.status === 'stored') return t('copy', 'report-progress');
    const failed = model.report?.failed_count ?? 0;
    return failed === 1 ? t('copy', 'report-rejected', { n: 1 }) : t('copy', 'report-rejected-n', { n: failed });
  };

  const renderReport = (model: Model | null) => {
    report.replaceChildren();
    if (!model) {
      report.append(el('p', { text: t('copy', 'upload-report-empty') }));
      return;
    }
    const heading = el('h2', { text: model.report && model.report.failed_count === 0 ? t('copy', 'report-accepted') : model.report ? reportHeading(model) : t('copy', 'report-progress') });
    const parts: HTMLElement[] = [heading];
    if (model.rulebook_version) {
      parts.push(el('p', { class: 'rulebook-line', text: t('copy', 'rulebook-line', { version: model.rulebook_version }) }));
    }
    if (model.report) {
      for (const section of ['failed', 'passed', 'skipped'] as const) {
        const rules = model.report.rules.filter((r) => r.status === (section === 'skipped' ? 'skipped' : section === 'failed' ? 'fail' : 'pass'));
        if (rules.length === 0) continue;
        const headingKey = section === 'failed' ? 'report-failed' : section === 'passed' ? 'report-passed' : 'report-not-checked';
        const box = el('div', { class: `report-section ${section}` });
        box.append(el('h3', { text: t('copy', headingKey) }));
        for (const rule of rules) {
          const item = el('div', { class: `rule-line ${rule.status}` });
          item.append(el('span', { class: 'rule-title', text: t('rules', rule.id) }));
          item.append(el('span', { class: 'rule-measure', text: ruleLine(rule) }));
          box.append(item);
        }
        parts.push(box);
      }
    }
    const equip = el('button', { class: 'primary', text: t('controls', 'equip-model') });
    equip.disabled = model.status !== 'accepted' && model.status !== 'equipped';
    equip.addEventListener('click', async () => {
      equip.disabled = true;
      equip.textContent = t('copy', 'working');
      const result = await api('POST', `/api/models/${model.id}/equip`);
      equip.textContent = t('controls', 'equip-model');
      equip.disabled = false;
      if (result.status === 200) notify(t('copy', 'model-equipped'));
      else notify(t('copy', 'model-not-accepted'));
    });
    const del = el('button', { class: 'ghost', text: t('controls', 'delete-model') });
    del.addEventListener('click', async () => {
      del.disabled = true;
      del.textContent = t('copy', 'working');
      const result = await api('DELETE', `/api/models/${model.id}`);
      del.textContent = t('controls', 'delete-model');
      del.disabled = false;
      if (result.status === 204) {
        notify(t('copy', 'model-deleted'));
        selectedModelId = null;
        const res = await getJson<{ models: Model[] }>('/api/models');
        renderList(res?.models ?? []);
        renderReport(null);
        upload.focus();
      } else if (result.status === 503) {
        banner.hidden = false;
        banner.textContent = t('copy', 'storage-outage-delete');
      }
    });
    parts.push(el('div', { class: 'button-row' }, equip, del));
    report.append(...parts);
  };

  const announceStage = (stage: string, text: string) => {
    if (announcedStages.has(stage)) return;
    announcedStages.add(stage);
    statusRegion.textContent = text;
  };

  upload.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    upload.disabled = true;
    upload.textContent = t('copy', 'working');
    announceStage('pending', t('copy', 'pending-upload'));
    const result = await api<{ model: Model }>('POST', '/api/models', file, { raw: true });
    upload.disabled = false;
    upload.textContent = t('controls', 'upload-model');
    if (result.status === 201 && result.data?.model) {
      const model = result.data.model;
      announceStage('stored', t('copy', 'upload-stored'));
      announceStage('validating', t('copy', 'upload-validating', { version: '2026.11-r1' }));
      selectedModelId = model.id;
      const res = await getJson<{ models: Model[] }>('/api/models');
      renderList(res?.models ?? []);
      const fresh = (res?.models ?? []).find((m) => m.id === model.id);
      renderReport(fresh ?? model);
    } else {
      const data = result.data as { error?: { code?: string } } | null;
      const code = data?.error?.code;
      if (code === 'too_large') announceStage('too-large', t('copy', 'upload-too-large'));
      else if (code === 'quota_exceeded') announceStage('quota', t('copy', 'upload-quota'));
      else if (code === 'unsupported_type' || code === 'not_gltf') announceStage('type', t('copy', 'not-gltf'));
      else if (result.status === 503) {
        banner.hidden = false;
        banner.textContent = t('copy', 'storage-outage-upload');
      }
      else announceStage('error', t('copy', 'generic-error'));
    }
    fileInput.value = '';
  });

  const res = await getJson<{ models: Model[] }>('/api/models');
  const models = res?.models ?? [];
  if (models.length > 0 && !selectedModelId) selectedModelId = models[0]?.id ?? null;
  renderList(models);
  renderReport(models.find((m) => m.id === selectedModelId) ?? null);
  updateBanner();

  main.append(banner, upload, fileInput, statusRegion, list, report, languagePickerHtml(), signOutButton());
  root.append(layout, main);

  // Realtime model status updates keep the list and report in place (DP-29).
  const { onEvent } = await import('./realtime-client.js');
  const { openRealtime } = await import('./realtime-client.js');
  onEvent(async (message) => {
    if (message.type !== 'event' || !message.event) return;
    const event = message.event as { kind?: string; model_id?: string; status?: string; failed_count?: number };
    if (event.kind !== 'model_status') return;
    const fresh = await getJson<{ models: Model[] }>('/api/models');
    const models = fresh?.models ?? [];
    renderList(models);
    const current = models.find((m) => m.id === (event.model_id ?? selectedModelId));
    if (current) {
      if (current.status === 'validating') announceStage('validating', t('copy', 'upload-validating', { version: current.rulebook_version ?? '2026.11-r1' }));
      if (current.status === 'accepted') announceStage('accepted', t('copy', 'upload-accepted'));
      if (current.status === 'rejected') announceStage('rejected', current.report ? (current.report.failed_count === 1 ? t('copy', 'upload-rejected', { n: 1 }) : t('copy', 'upload-rejected-n', { n: current.report.failed_count })) : t('copy', 'generic-error'));
      renderReport(current);
    }
  });
  openRealtime();
}

export async function mountStories(): Promise<void> {
  await loadMe();
  await import('./store.js').then(({ loadStories }) => loadStories());
  const root = document.getElementById('root');
  if (!root) return;
  root.replaceChildren();
  const layout = el('div', { class: 'screen-layout' });
  layout.append(navTabs('/stories'));
  const main = el('section', { class: 'page-main' });
  main.append(el('h1', { class: 'screen-heading', text: t('copy', 'stories-heading') }));
  for (const story of store.stories) {
    const card = el('div', { class: 'story-card' });
    card.append(el('h2', { text: story.title }));
    card.append(el('p', { text: story.mode === 'solo' ? t('copy', 'stories-solo') : t('copy', 'stories-coop') }));
    const chaptersBox = el('div', { class: 'chapter-row' });
    for (let chapter = 1; chapter <= story.chapters; chapter++) {
      const chapterLabel = el('span', { class: 'chapter-label', text: t('copy', 'chapter-label', { n: chapter }) });
      if (story.mode === 'solo') {
        const unlocked = chapter <= (story.progress?.unlocked_chapter ?? 1);
        const button = el('button', { class: 'primary', text: t('controls', 'play-chapter', { n: chapter }), disabled: !unlocked });
        button.addEventListener('click', async () => {
          const result = await api<{ session_id: string }>('POST', `/api/stories/${story.id}/sessions`, { chapter });
          if (result.status === 201 && result.data?.session_id) {
            location.href = `/play/${result.data.session_id}`;
          } else if (result.status === 409) {
            notify(t('copy', 'chapter-locked'));
          } else {
            notify(t('copy', 'generic-error'));
          }
        });
        chaptersBox.append(chapterLabel, button);
      } else {
        chaptersBox.append(chapterLabel);
      }
    }
    card.append(chaptersBox);
    if (story.mode === 'coop') {
      const lobby = el('a', { href: '/lobby', class: 'secondary-link', text: t('nav', 'lobby') });
      card.append(lobby);
    }
    main.append(card);
  }
  main.append(languagePickerHtml(), signOutButton());
  root.append(layout, main);
}
