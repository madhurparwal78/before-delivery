import {
  ApiFailure,
  AssetView,
  JobView,
  LineageNode,
  LineageView,
  MeterView,
  ModelView,
  QueueView,
  api,
} from '../api';
import { clear, el, num, openDialog } from '../dom';
import { credits, elapsedSeconds, longDate, periodEndDate, rate as formatRate } from '../format';
import { openJobDialog } from '../jobdialog';
import { Ribbon } from '../meter';
import { RunFormHandle, buildRunForm, validateInBrowser } from '../runform';
import { Shell, alertError, clearMessages, notice } from '../shell';
import { noteZoneFromPeriod, state, teamName } from '../state';
import { openAssetDialog, setPendingInput, takePendingInput } from './library';

const MODALITY_HEADINGS: { modality: ModelView['modality']; heading: string }[] = [
  { modality: 'image', heading: 'Image' },
  { modality: 'video', heading: 'Video' },
  { modality: 'audio', heading: 'Audio' },
];

interface StripNode {
  id: string;
  state: 'live' | 'tombstone';
  thumbnail: string | null;
  mediaType: string;
  removedAt?: string;
  reason?: string;
}

function singularUnit(unitLabel: string): string {
  return unitLabel.endsWith('s') ? unitLabel.slice(0, -1) : unitLabel;
}

function toStripNode(node: LineageNode): StripNode {
  if (node.state === 'tombstone') {
    return {
      id: node.id,
      state: 'tombstone',
      thumbnail: null,
      mediaType: '',
      removedAt: node.removed_at,
      reason: node.reason,
    };
  }
  return { id: node.id, state: 'live', thumbnail: node.thumbnail_url, mediaType: node.media_type };
}

export function mountRun(shell: Shell): () => void {
  const teamId = state.member!.team_id!;
  let chosen: ModelView | null = null;
  let formHandle: RunFormHandle | null = null;
  let lineageFocus: string | null = null;
  let renderedQueue = '';
  let renderedLineage = '';
  const timers: number[] = [];
  const jobsById = new Map<string, JobView>();
  const ribbon = new Ribbon();
  const rail = el('nav', { class: 'rail', 'aria-label': 'Catalogue' });
  const formColumn = el('section', { class: 'form-column' });
  const queueRegion = el('section', { class: 'queue', role: 'region', 'aria-label': 'Queue' });
  const lineageRegion = el('section', { class: 'lineage', role: 'region', 'aria-label': 'Lineage' });

  function buildRail(target: HTMLElement, insideDialog: boolean, close?: () => void): void {
    clear(target);
    for (const group of MODALITY_HEADINGS) {
      const models = state.models.filter((model) => model.modality === group.modality);
      if (models.length === 0) continue;
      target.append(el('h4', { class: 'rail-heading', text: group.heading }));
      const list = el('div', { class: 'rail-group' });
      for (const model of models) {
        const blocked = model.access?.playground === 'blocked';
        const button = el(
          'button',
          {
            type: 'button',
            class: `rail-item${blocked ? ' rail-item-blocked' : ''}`,
            'aria-pressed': chosen?.slug === model.slug ? 'true' : 'false',
            'aria-disabled': blocked ? 'true' : null,
          },
          [
            el('span', { class: 'rail-name', text: model.name }),
            el('span', { class: 'rail-meta' }, [
              el('span', { class: 'num', text: formatRate(model.current_rate?.micro_per_unit ?? 0) }),
              el('span', { class: 'rail-unit', text: ` credits per ${singularUnit(model.unit_label)}` }),
            ]),
            blocked ? el('span', { class: 'rail-blocked', text: 'Blocked for playground' }) : null,
          ],
        );
        if (!blocked) {
          button.addEventListener('click', () => {
            chooseModel(model);
            if (insideDialog) close?.();
          });
        }
        list.append(button);
      }
      target.append(list);
    }
  }

  function chooseModel(model: ModelView, moveFocus = true): void {
    chosen = model;
    clear(formColumn);
    const handle = buildRunForm(model, { onChange: () => handle.updateEstimate() });
    formHandle = handle;
    formColumn.append(el('h3', { class: 'section-heading', text: `Run ${model.name}` }), handle.form);
    handle.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
    });
    buildRail(rail, false);
    if (moveFocus) handle.focusFirst();
  }

  async function submit(): Promise<void> {
    if (!chosen || !formHandle) return;
    clearMessages();
    const model = chosen;
    const handle = formHandle;
    const values = handle.values();
    const errors = validateInBrowser(model, values);
    handle.showErrors(errors);
    if (Object.keys(errors).length > 0) {
      alertError('Fix the highlighted fields.');
      return;
    }
    const key = crypto.randomUUID();
    const body = { model: model.slug, input: values, priority: 'normal' };
    const attempt = () =>
      api.post<{ job: JobView; replayed?: boolean }>('/api/jobs', body, { 'idempotency-key': key });
    handle.setBusy(true);
    notice('Submitting…');
    try {
      let response: { job: JobView; replayed?: boolean };
      try {
        response = await attempt();
      } catch (error) {
        if (error instanceof ApiFailure) throw error;
        response = await attempt();
      }
      if (response.replayed === true) {
        notice(`Job ${response.job.id} was already submitted; nothing new was reserved.`);
      } else {
        notice(`Job ${response.job.id} queued — ${credits(response.job.reserved_micro)} credits reserved.`);
      }
      await refresh();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 422) {
        handle.showErrors(error.fields);
        alertError('Fix the highlighted fields.');
      } else if (error.status === 402) {
        alertError(
          `Not enough credits: this run needs ${credits(error.detail.required_micro ?? 0)} and ${credits(
            error.detail.available_micro ?? 0,
          )} are available.`,
        );
      } else if (error.status === 429) {
        const meter = await api.get<MeterView>(`/api/teams/${teamId}/meter`);
        alertError(
          `${teamName(teamId)} reached its hard cap for ${meter.period.label}. New jobs are throttled until ${periodEndDate(
            meter.period.label,
            meter.period.ends_at,
          )}.`,
        );
      } else if (error.code === 'model_blocked') {
        alertError(`${model.name} is blocked for playground runs in ${teamName(teamId)}.`);
      } else if (error.status === 503) {
        alertError('Storage is unreachable, so the image could not be saved. Nothing was reserved.');
      } else {
        alertError(error.message);
      }
    } finally {
      handle.setBusy(false);
    }
  }

  function cancel(job: JobView): void {
    notice('Cancelling…');
    void api
      .post<{ job: JobView }>(`/api/jobs/${job.id}/cancel`)
      .then((response) => {
        notice(`Job ${job.id} cancelled; ${credits(response.job.released_micro)} credits released.`);
        void refresh();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 409) {
          alertError(`Job ${job.id} already ${error.detail.status ?? 'finished'}; nothing to cancel.`);
        } else alertError(error.message);
      });
  }

  function queueSignature(queue: QueueView): string {
    return queue.lanes
      .map((lane) =>
        [...lane.running, ...lane.queued]
          .map((job) => `${lane.model}:${job.id}:${job.status}:${job.queue_position}:${job.waiting_reason}`)
          .join(','),
      )
      .join('|');
  }

  function renderQueue(queue: QueueView): void {
    const signature = queueSignature(queue);
    if (signature === renderedQueue) return;
    renderedQueue = signature;
    clear(queueRegion);
    queueRegion.append(el('h3', { class: 'section-heading', text: 'Queue' }));
    const lanes = el('div', { class: 'lanes' });
    for (const model of state.models) {
      const lane = queue.lanes.find((candidate) => candidate.model === model.slug);
      const items = [...(lane?.running ?? []), ...(lane?.queued ?? [])];
      const list = el('ul', { class: 'lane', role: 'list', 'aria-label': `${model.name} lane` });
      for (const job of items) {
        const label =
          job.status === 'queued'
            ? `${job.id} · queued #${job.queue_position ?? 0}`
            : `${job.id} · ${job.status} · ${elapsedSeconds(job.started_at)}`;
        const open = el('button', { type: 'button', class: 'lane-open', 'aria-label': `Open job ${job.id}` }, [
          num(label),
        ]);
        open.addEventListener('click', () => openJobDialog(job, { onChanged: () => void refresh(), opener: open }));
        const children: Node[] = [open];
        if (job.waiting_reason !== null) {
          children.push(el('span', { class: 'lane-waiting', text: 'Waiting for storage' }));
        }
        const cancelButton = el('button', {
          type: 'button',
          class: 'lane-cancel',
          'aria-label': `Cancel job ${job.id}`,
          text: 'Cancel',
        });
        cancelButton.addEventListener('click', () => cancel(job));
        children.push(cancelButton);
        list.append(el('li', { class: 'lane-item' }, children));
      }
      lanes.append(el('div', { class: 'lane-box' }, [el('h5', { class: 'lane-title', text: model.name }), list]));
    }
    queueRegion.append(lanes);
  }

  function renderLineage(nodes: StripNode[], edges: { from: string; to: string }[]): void {
    const signature = `${lineageFocus ?? ''}#${nodes.map((node) => `${node.id}:${node.state}`).join(',')}`;
    if (signature === renderedLineage) return;
    renderedLineage = signature;
    clear(lineageRegion);
    lineageRegion.append(el('h3', { class: 'section-heading', text: 'Lineage' }));
    const strip = el('div', { class: 'lineage-strip' });
    nodes.forEach((node, index) => {
      const previous = nodes[index - 1];
      if (previous) {
        const linked = edges.some(
          (edge) =>
            (edge.from === previous.id && edge.to === node.id) || (edge.to === previous.id && edge.from === node.id),
        );
        strip.append(el('span', { class: `connector${linked ? ' connector-linked' : ''}`, 'aria-hidden': 'true' }));
      }
      if (node.state === 'tombstone') {
        const tombstone = el(
          'button',
          { type: 'button', class: 'lineage-node lineage-tombstone', 'aria-label': `Removed asset ${node.id}` },
          [
            el('span', { class: 'tombstone-mark', 'aria-hidden': 'true', text: '·' }),
            el('span', {
              class: 'tombstone-text',
              text: `Removed ${longDate(node.removedAt ?? '')} (${node.reason ?? 'deleted'})`,
            }),
          ],
        );
        tombstone.addEventListener('click', () => {
          lineageFocus = null;
          void refreshLineage();
        });
        strip.append(tombstone);
        return;
      }
      const button = el(
        'button',
        {
          type: 'button',
          class: `lineage-node${lineageFocus === node.id ? ' lineage-node-current' : ''}`,
          'aria-label': `Asset ${node.id}`,
        },
        [
          node.thumbnail
            ? el('img', { src: node.thumbnail, alt: '', class: 'lineage-thumb' })
            : el('span', {
                class: 'media-glyph',
                text: node.mediaType.startsWith('video') ? 'VID' : node.mediaType.startsWith('audio') ? 'AUD' : 'IMG',
              }),
          num(node.id),
        ],
      );
      button.addEventListener('click', () => {
        lineageFocus = node.id;
        void openAssetDialog(node.id, {
          opener: button,
          onChanged: () => void refreshLineage(),
          onUseAsInput: (assetId) => {
            setPendingInput(assetId);
            applyPendingInput();
          },
        });
        void refreshLineage();
      });
      strip.append(button);
    });
    lineageRegion.append(strip);
  }

  async function resolveNode(assetId: string): Promise<StripNode | null> {
    try {
      const response = await api.get<{ asset: AssetView }>(`/api/assets/${assetId}`);
      return {
        id: response.asset.id,
        state: 'live',
        thumbnail: response.asset.media_type.startsWith('image/') ? response.asset.url : null,
        mediaType: response.asset.media_type,
      };
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status !== 410) return null;
      return {
        id: assetId,
        state: 'tombstone',
        thumbnail: null,
        mediaType: '',
        removedAt: error.detail.removed_at ?? new Date().toISOString(),
        reason: error.detail.reason ?? 'deleted',
      };
    }
  }

  async function stripContent(): Promise<{ nodes: StripNode[]; edges: { from: string; to: string }[] }> {
    if (lineageFocus !== null) {
      try {
        const lineage = await api.get<LineageView>(`/api/assets/${lineageFocus}/lineage`);
        return { nodes: lineage.nodes.map(toStripNode), edges: lineage.edges };
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        lineageFocus = null;
      }
    }
    const response = await api.get<{ assets: AssetView[] }>(
      `/api/assets?kind=output&team=${encodeURIComponent(teamId)}`,
    );
    const live = response.assets.slice(0, 20).reverse();
    const nodes: StripNode[] = live.map((asset) => ({
      id: asset.id,
      state: 'live',
      thumbnail: asset.media_type.startsWith('image/') ? asset.url : null,
      mediaType: asset.media_type,
    }));
    const edges: { from: string; to: string }[] = [];
    const known = new Set(nodes.map((node) => node.id));
    for (const asset of live) {
      for (const source of asset.derived_from ?? []) {
        edges.push({ from: source, to: asset.id });
        if (known.has(source)) continue;
        known.add(source);
        const resolved = await resolveNode(source);
        if (resolved) nodes.unshift(resolved);
      }
    }
    return { nodes, edges };
  }

  async function refreshLineage(): Promise<void> {
    const { nodes, edges } = await stripContent();
    renderLineage(nodes, edges);
  }

  async function refresh(): Promise<void> {
    const [meter, queue, jobs] = await Promise.all([
      api.get<MeterView>(`/api/teams/${teamId}/meter`),
      api.get<QueueView>('/api/queue'),
      api.get<{ jobs: JobView[] }>('/api/jobs?limit=30'),
    ]);
    noteZoneFromPeriod(meter.period.label, meter.period.starts_at);
    jobsById.clear();
    for (const job of jobs.jobs) jobsById.set(job.id, job);
    ribbon.update(meter, jobsById);
    renderQueue(queue);
  }

  function hasMediaField(model: ModelView): boolean {
    return Object.values(model.input_schema.properties).some((property) =>
      (property.contentMediaType ?? '').startsWith('image/'),
    );
  }

  function applyPendingInput(): void {
    const assetId = takePendingInput();
    if (assetId === null) return;
    const model =
      chosen && hasMediaField(chosen)
        ? chosen
        : state.models.find((candidate) => candidate.slug === 'reel-10' && candidate.access?.playground !== 'blocked') ??
          state.models.find((candidate) => hasMediaField(candidate) && candidate.access?.playground !== 'blocked');
    if (!model) return;
    if (chosen?.slug !== model.slug) chooseModel(model);
    const field = formHandle?.fields.find((candidate) => candidate.isMedia);
    if (!field) return;
    (field.control as HTMLInputElement).value = `asset:${assetId}`;
    formHandle?.updateEstimate();
    field.control.focus();
  }

  shell.railSlot.append(rail);
  const catalogueButton = el('button', { type: 'button', class: 'catalogue-button', text: 'Catalogue' });
  catalogueButton.addEventListener('click', () => {
    openDialog({
      label: 'Catalogue',
      opener: catalogueButton,
      content: (close) => {
        const holder = el('nav', { class: 'rail rail-dialog', 'aria-label': 'Catalogue' });
        buildRail(holder, true, () => {
          close();
          formHandle?.focusFirst();
        });
        const closeButton = el('button', { type: 'button', class: 'secondary', text: 'Close' });
        closeButton.addEventListener('click', close);
        return [
          el('h2', { class: 'dialog-title', text: 'Catalogue' }),
          holder,
          el('div', { class: 'dialog-actions' }, [closeButton]),
        ];
      },
    });
  });
  shell.topbarExtras.append(catalogueButton);

  shell.main.append(ribbon.root, el('div', { class: 'run-grid' }, [formColumn, queueRegion]), lineageRegion);
  ribbon.onOpenJob((jobId) => {
    const job = jobsById.get(jobId);
    if (job) openJobDialog(job, { onChanged: () => void refresh() });
  });

  const first = state.models.find((model) => model.access?.playground !== 'blocked') ?? state.models[0];
  if (first) chooseModel(first, false);
  applyPendingInput();
  void refresh();
  void refreshLineage();

  timers.push(window.setInterval(() => void refresh(), 1500));
  timers.push(window.setInterval(() => void refreshLineage(), 6000));
  timers.push(
    window.setInterval(() => {
      for (const node of document.querySelectorAll<HTMLElement>('.lane-open .num')) {
        const match = /^(j_\d+) · (running|leased) · (\d+)s$/.exec(node.textContent ?? '');
        if (match) node.textContent = `${match[1]} · ${match[2]} · ${Number.parseInt(match[3]!, 10) + 1}s`;
      }
    }, 1000),
  );

  return () => {
    for (const timer of timers) window.clearInterval(timer);
    rail.remove();
    catalogueButton.remove();
  };
}
