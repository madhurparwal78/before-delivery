import { ApiFailure, api } from '../api.js';
import { clear, el } from '../dom.js';
import { realtime } from '../realtime.js';
import { withPending, type AppContext, type Screen } from './shared.js';
import { fmtCount, fmtFixed, type MessageKey } from '../../shared/i18n/index.js';
import { RULEBOOK_VERSION } from '../../shared/constants.js';
import { degreesToStoredRadians } from '../../shared/pose.js';
import type { Character, ModelRecord, Report, RuleResult } from '../../shared/types.js';

type Stage = 'pending' | 'stored' | 'validating' | 'verdict';

export async function renderModels(ctx: AppContext, host: HTMLElement): Promise<Screen> {
  let models = (await api.get<{ models: ModelRecord[] }>('/api/models')).models;
  let selectedId: string | null = models[0]?.id ?? null;
  const announced = new Map<string, Set<Stage>>();

  const uploadStatus = el('div', {
    class: 'live-region',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': ctx.t('status.uploadStatus'),
  });

  const fileInput = el('input', {
    type: 'file',
    accept: '.glb,model/gltf-binary',
    'aria-label': ctx.t('field.modelFile'),
    class: 'file-input',
  }) as HTMLInputElement;

  const uploadButton = el('button', { type: 'button', class: 'button primary' }, [
    ctx.t('btn.uploadModel'),
  ]) as HTMLButtonElement;

  const list = el('ul', { class: 'model-list', role: 'list', 'aria-label': ctx.t('list.myModels') });
  const reportRegion = el('section', {
    class: 'paper-card report',
    role: 'region',
    'aria-label': ctx.t('region.uploadReport'),
  });
  const equipButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.equipModel'),
  ]) as HTMLButtonElement;
  const deleteButton = el('button', { type: 'button', class: 'button' }, [
    ctx.t('btn.deleteModel'),
  ]) as HTMLButtonElement;

  host.append(
    el('div', { class: 'page models-page' }, [
      el('div', { class: 'models-actions' }, [uploadButton, fileInput]),
      uploadStatus,
      el('div', { class: 'models-columns' }, [
        el('div', {}, [list, el('div', { class: 'card-actions' }, [equipButton, deleteButton])]),
        reportRegion,
      ]),
    ]),
  );

  if (ctx.account?.storage_notice === 'upload_unavailable') {
    ctx.setBanner(ctx.t('fb.storageUpload'));
  } else if (ctx.account?.storage_notice === 'delete_unavailable') {
    ctx.setBanner(ctx.t('fb.storageDelete'));
  }

  const announce = (modelId: string, stage: Stage, text: string): void => {
    const seen = announced.get(modelId) ?? new Set<Stage>();
    if (seen.has(stage)) return;
    seen.add(stage);
    announced.set(modelId, seen);
    uploadStatus.textContent = text;
  };

  const ruleLine = (rule: RuleResult): string => {
    if (rule.status === 'skipped') return ctx.t('ruleline.skipped');
    if (rule.id === 'R01') return ctx.t('ruleline.header');
    if (rule.id === 'R06') {
      const missing = typeof rule.measured === 'string' ? rule.measured : '';
      return missing === ''
        ? ctx.t('ruleline.nothingMissing')
        : ctx.t('ruleline.missing', { measured: missing });
    }
    if (rule.id === 'R10') {
      if (!Array.isArray(rule.measured)) return ctx.t('ruleline.matrix');
      const [x, y, z, w] = rule.measured;
      return ctx.t('ruleline.rotation', {
        w: fmtFixed(ctx.locale, w, 4),
        x: fmtFixed(ctx.locale, x, 4),
        y: fmtFixed(ctx.locale, y, 4),
        z: fmtFixed(ctx.locale, z, 4),
      });
    }
    return ctx.t('ruleline.measured', {
      measured: fmtCount(ctx.locale, typeof rule.measured === 'number' ? rule.measured : 0),
      limit: fmtCount(ctx.locale, rule.limit ?? 0),
    });
  };

  const reportSection = (titleKey: MessageKey, rules: RuleResult[]): HTMLElement | null => {
    if (rules.length === 0) return null;
    return el('div', { class: 'report-section' }, [
      el('h3', { text: ctx.t(titleKey) }),
      el(
        'ul',
        {},
        rules.map((rule) =>
          el('li', { class: `rule rule-${rule.status}` }, [
            el('span', { class: 'rule-title', text: ctx.t(`rule.${rule.id}` as MessageKey) }),
            el('span', { class: 'rule-line', text: ruleLine(rule) }),
          ]),
        ),
      ),
    ]);
  };

  const renderReport = (model: ModelRecord | null): void => {
    clear(reportRegion);
    if (model === null) {
      reportRegion.append(el('p', { text: ctx.t('models.noSelection') }));
      return;
    }
    const report: Report | null = model.report;
    const heading =
      report === null
        ? ctx.t('report.inProgress')
        : report.failed_count === 0
          ? ctx.t('report.accepted')
          : report.failed_count === 1
            ? ctx.t('report.rejectedOne')
            : ctx.t('report.rejectedMany', { n: report.failed_count });
    reportRegion.append(el('h2', { text: heading }));
    if (report === null) return;
    reportRegion.append(
      el('p', {
        class: 'rulebook-line',
        text: ctx.t('report.rulebookLine', { version: report.rulebook_version }),
      }),
    );
    const failed = report.rules.filter((rule) => rule.status === 'fail');
    const passed = report.rules.filter((rule) => rule.status === 'pass');
    const skipped = report.rules.filter((rule) => rule.status === 'skipped');
    for (const section of [
      reportSection('report.failedRules', failed),
      reportSection('report.passedRules', passed),
      reportSection('report.notChecked', skipped),
    ]) {
      if (section !== null) reportRegion.append(section);
    }
  };

  interface Row {
    item: HTMLElement;
    button: HTMLButtonElement;
    status: HTMLElement;
    thumb: HTMLImageElement;
  }
  const rows = new Map<string, Row>();

  const statusText = (model: ModelRecord): string =>
    ctx.t(`model.status.${model.status}` as MessageKey);

  const select = (id: string): void => {
    selectedId = id;
    for (const [modelId, row] of rows) {
      row.button.setAttribute('aria-current', String(modelId === id));
    }
    renderReport(models.find((model) => model.id === id) ?? null);
    const model = models.find((entry) => entry.id === id) ?? null;
    equipButton.disabled = model === null || (model.status !== 'accepted' && model.status !== 'equipped');
    deleteButton.disabled = model === null;
  };

  /** Patches the list in place so the focused element is never replaced. */
  const syncList = (): void => {
    for (const [id, row] of rows) {
      if (!models.some((model) => model.id === id)) {
        row.item.remove();
        rows.delete(id);
      }
    }
    models.forEach((model, index) => {
      const existing = rows.get(model.id);
      if (existing !== undefined) {
        existing.status.textContent = statusText(model);
        existing.button.setAttribute('aria-current', String(model.id === selectedId));
        if (model.status === 'accepted' || model.status === 'equipped') {
          existing.thumb.src = `/api/models/${model.id}/thumbnail`;
          existing.thumb.hidden = false;
        } else {
          existing.thumb.hidden = true;
        }
        return;
      }
      const status = el('span', { class: 'model-status', text: statusText(model) });
      const thumb = el('img', { class: 'model-thumb', alt: '' }) as HTMLImageElement;
      const hasThumbnail = model.status === 'accepted' || model.status === 'equipped';
      if (hasThumbnail) thumb.src = `/api/models/${model.id}/thumbnail`;
      thumb.hidden = !hasThumbnail;
      const button = el('button', {
        type: 'button',
        class: 'model-button',
        'aria-current': String(model.id === selectedId),
      }, [el('span', { text: model.filename }), status, thumb]) as HTMLButtonElement;
      button.addEventListener('click', () => select(model.id));
      const item = el('li', {}, [button]);
      // New rows are inserted where they belong, so no existing row ever moves.
      const follower = models.slice(index + 1).find((entry) => rows.has(entry.id));
      const followerItem = follower === undefined ? null : (rows.get(follower.id)?.item ?? null);
      if (followerItem === null) list.append(item);
      else list.insertBefore(item, followerItem);
      rows.set(model.id, { item, button, status, thumb });
    });
  };

  const reload = async (): Promise<void> => {
    models = (await api.get<{ models: ModelRecord[] }>('/api/models')).models;
    syncList();
    if (selectedId !== null) select(selectedId);
    else renderReport(null);
  };

  uploadButton.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    uploadStatus.textContent = ctx.t('fb.pendingUpload');
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const { model } = await api.upload<{ model: ModelRecord }>('/api/models', bytes, file.name);
        models = [model, ...models];
        syncList();
        select(model.id);
        announced.set(model.id, new Set<Stage>(['pending']));
        announce(model.id, 'stored', ctx.t('fb.uploadStored'));
        ctx.setBanner(null);
        await ctx.refreshAccount();
      } catch (failure) {
        if (failure instanceof ApiFailure) {
          if (failure.code === 'storage_unavailable') {
            ctx.setBanner(failure.localisedMessage);
            await ctx.refreshAccount();
            return;
          }
          uploadStatus.textContent = failure.localisedMessage;
          return;
        }
        uploadStatus.textContent = ctx.t('fb.generic');
      } finally {
        fileInput.value = '';
      }
    })();
  });

  equipButton.addEventListener('click', () => {
    void withPending(ctx, equipButton, async () => {
      const model = models.find((entry) => entry.id === selectedId);
      if (model === undefined) return;
      try {
        const { characters } = await api.get<{ characters: Character[] }>('/api/characters');
        const hero = characters.find((entry) => entry.equipped) ?? characters[0];
        if (hero === undefined) return;
        await api.put(`/api/characters/slots/${hero.slot}`, {
          revision: hero.revision,
          name: hero.name,
          parts: hero.parts,
          proportions: hero.proportions,
          pose: { right_arm_raise: degreesToStoredRadians((hero.pose.right_arm_raise * 180) / Math.PI) },
          material: hero.material,
          accessories: hero.accessories,
          model_id: model.id,
          weapon_id: hero.weapon_id,
        });
        ctx.announce(ctx.t('fb.modelEquipped'));
        await reload();
      } catch (failure) {
        ctx.announce(
          failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
        );
      }
    });
  });

  deleteButton.addEventListener('click', () => {
    void withPending(ctx, deleteButton, async () => {
      const model = models.find((entry) => entry.id === selectedId);
      if (model === undefined) return;
      try {
        await api.delete(`/api/models/${model.id}`);
        models = models.filter((entry) => entry.id !== model.id);
        rows.get(model.id)?.item.remove();
        rows.delete(model.id);
        selectedId = models[0]?.id ?? null;
        if (selectedId !== null) select(selectedId);
        else renderReport(null);
        ctx.announce(ctx.t('fb.modelDeleted'));
        ctx.setBanner(null);
        await ctx.refreshAccount();
        uploadButton.focus();
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.code === 'storage_unavailable') {
          ctx.setBanner(failure.localisedMessage);
          await ctx.refreshAccount();
          return;
        }
        ctx.announce(
          failure instanceof ApiFailure ? failure.localisedMessage : ctx.t('fb.generic'),
        );
      }
    });
  });

  const offEvent = realtime.onEvent((event) => {
    if (event.event.kind !== 'model_status') return;
    const modelId = String(event.event.model_id);
    const status = String(event.event.status);
    void (async () => {
      await reload();
      if (status === 'validating') {
        announce(modelId, 'validating', ctx.t('fb.uploadValidating', { version: RULEBOOK_VERSION }));
        return;
      }
      const failedCount = Number(event.event.failed_count ?? 0);
      const text =
        failedCount === 0
          ? ctx.t('fb.uploadAccepted')
          : failedCount === 1
            ? ctx.t('fb.uploadRejectedOne')
            : ctx.t('fb.uploadRejectedMany', { n: failedCount });
      announce(modelId, 'verdict', text);
    })();
  });

  syncList();
  if (selectedId !== null) select(selectedId);
  else renderReport(null);

  return { destroy: () => offEvent() };
}
